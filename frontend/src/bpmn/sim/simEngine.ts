// ── Motor de simulación de eventos discretos (DES) basado en tokens ──────────
// Precomputa toda la corrida en "tiempo de simulación" (minutos) y produce:
//   1) una línea de tiempo de SEGMENTOS para animar (tokens recorriendo flujos
//      y permaneciendo en tareas), y
//   2) los KPIs cuantitativos del proceso: cycle time, waiting, processing,
//      utilización de recursos, costo, cycle-time efficiency.

import { sample, makeRng, type Distribution } from "./distributions";
import { addWorkingMinutes, type Timetable } from "./calendar";
import type { SimGraph } from "./simGraph";

export interface ResourceDef {
  capacity: number;
  costPerHour: number;
  /** Timetable asignado (horario laboral). Si falta → 24/7. */
  timetableId?: string;
}

export interface TaskConfig {
  duration: Distribution;
  resource?: string;
  /** Costo fijo por ejecución (además del costo por tiempo del recurso). */
  fixedCost?: number;
  /** Umbral de costo (para contar ejecuciones que lo superan). */
  costThreshold?: number;
  /** Umbral de duración en min (para contar ejecuciones que lo superan). */
  durationThreshold?: number;
}

export interface SimConfig {
  instances: number;
  arrival: Distribution; // inter-arribo (min)
  defaultTask: Distribution; // duración por defecto de tareas
  transferTime: number; // tiempo de traslado por flujo (min) — visual + cycle time
  /** Por nodo-tarea: distribución de duración + recurso + costos/umbrales. */
  tasks: Record<string, TaskConfig>;
  /** Timetables disponibles (id → ventana laboral). */
  timetables?: Record<string, Timetable>;
  /** Fecha/hora de inicio del escenario (epoch ms) para mapear el calendario. */
  startDateMs?: number;
  /** % de instancias completadas a excluir de estadísticas (warmup). */
  warmupPercent?: number;
  /** Símbolo/código de moneda (sólo para mostrar). */
  currency?: string;
  /** Demora de eventos intermedios/timer (min) — p. ej. "esperar 5 días". */
  delays?: Record<string, Distribution>;
  /**
   * Por evento de borde (boundary): distribución de su DURACIÓN (min).
   * Modelo de carrera: compite contra la duración de la tarea;
   * dispara sólo si su tiempo resulta menor. Si no está aquí → nunca dispara.
   */
  boundaries?: Record<string, Distribution>;
  /** Por compuerta: { flowId: peso }. Se normaliza a probabilidad. */
  gateways: Record<string, Record<string, number>>;
  resources: Record<string, ResourceDef>;
  seed: number;
}

export type SegmentKind = "flow" | "node";

export interface Segment {
  tokenId: string;
  caseId: number;
  kind: SegmentKind;
  refId: string; // flowId o nodeId
  nodeKind?: string;
  tStart: number;
  tEnd: number;
  active?: boolean; // tarea en procesamiento (para resaltar)
}

export interface ActivityStat {
  id: string;
  name: string;
  visits: number;
  totalProcessing: number;
  totalWaiting: number;
  cost: number;
  /** Ejecuciones que superaron el umbral de duración / costo. */
  durOverThreshold: number;
  costOverThreshold: number;
}

export interface ResourceStat {
  name: string;
  capacity: number;
  busyTime: number;
  utilization: number; // 0..1
  cost: number;
}

export interface SimResult {
  segments: Segment[];
  maxTime: number;
  started: number;
  completed: number;
  avgCycle: number;
  minCycle: number;
  maxCycle: number;
  /** Cycle time excluyendo horas fuera de horario (sólo tiempo hábil). */
  avgCycleExcl: number;
  minCycleExcl: number;
  maxCycleExcl: number;
  avgProcessing: number;
  avgWaiting: number;
  avgTransfer: number;
  cycleEfficiency: number;
  throughputPerHour: number;
  totalCost: number;
  cycleSamples: number[];
  activities: ActivityStat[];
  resources: ResourceStat[];
  warnings: string[];
  currency: string;
}

// ── Cola de prioridad (min-heap) por tiempo ──────────────────────────────────
interface Ev {
  t: number;
  seq: number;
  fn: () => void;
}
class PQ {
  private h: Ev[] = [];
  private seq = 0;
  push(t: number, fn: () => void) {
    const e: Ev = { t, seq: this.seq++, fn };
    this.h.push(e);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(this.h[i], this.h[p])) {
        [this.h[i], this.h[p]] = [this.h[p], this.h[i]];
        i = p;
      } else break;
    }
  }
  pop(): Ev | undefined {
    const n = this.h.length;
    if (n === 0) return undefined;
    const top = this.h[0];
    const last = this.h.pop()!;
    if (n > 1) {
      this.h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < this.h.length && this.less(this.h[l], this.h[m])) m = l;
        if (r < this.h.length && this.less(this.h[r], this.h[m])) m = r;
        if (m === i) break;
        [this.h[i], this.h[m]] = [this.h[m], this.h[i]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.h.length;
  }
  private less(a: Ev, b: Ev) {
    return a.t < b.t || (a.t === b.t && a.seq < b.seq);
  }
}

const MAX_EVENTS = 8_000_000; // tope alto: sólo frena bucles infinitos reales
const MAX_VISITS_PER_CASE = 1000; // corta bucles de rework infinitos

export function runSimulation(graph: SimGraph, config: SimConfig): SimResult {
  const rng = makeRng(config.seed || 12345);
  const pq = new PQ();
  const segments: Segment[] = [];
  const warnings: string[] = [];

  // estado de recursos
  interface ResState {
    def: ResourceDef;
    busy: number;
    busyTime: number;
    lastChange: number;
    queue: Array<(t: number) => void>;
  }
  const res = new Map<string, ResState>();
  for (const [name, def] of Object.entries(config.resources)) {
    res.set(name, { def, busy: 0, busyTime: 0, lastChange: 0, queue: [] });
  }
  function touchRes(r: ResState, now: number) {
    r.busyTime += r.busy * (now - r.lastChange);
    r.lastChange = now;
  }
  function seize(name: string, now: number, cb: (start: number) => void) {
    const r = res.get(name);
    if (!r) {
      cb(now);
      return;
    }
    if (r.busy < r.def.capacity) {
      touchRes(r, now);
      r.busy++;
      cb(now);
    } else {
      r.queue.push((t) => {
        touchRes(r, t);
        r.busy++;
        cb(t);
      });
    }
  }
  function release(name: string, now: number) {
    const r = res.get(name);
    if (!r) return;
    touchRes(r, now);
    r.busy--;
    const next = r.queue.shift();
    if (next) next(now);
  }

  // estadísticas
  const caseStart = new Map<number, number>();
  const caseProcessing = new Map<number, number>();
  const caseWaiting = new Map<number, number>();
  const caseTransfer = new Map<number, number>();
  const caseVisits = new Map<number, number>();
  const cycleSamples: number[] = [];
  const cycleWorkSamples: number[] = []; // excluyendo horas fuera de horario
  const actStat = new Map<string, ActivityStat>();
  let started = 0;
  let completed = 0;
  let maxTime = 0;
  let eventCount = 0;

  function actOf(nodeId: string): ActivityStat {
    let a = actStat.get(nodeId);
    if (!a) {
      const n = graph.nodes.get(nodeId);
      a = { id: nodeId, name: n?.name || nodeId, visits: 0, totalProcessing: 0, totalWaiting: 0, cost: 0, durOverThreshold: 0, costOverThreshold: 0 };
      actStat.set(nodeId, a);
    }
    return a;
  }

  // calendario base
  const baseDate = new Date(config.startDateMs ?? Date.now());

  // sincronización de joins AND/OR: clave `${nodeId}|${caseId}` -> set de flows llegados
  const joinArrivals = new Map<string, Set<string>>();

  function chooseOutgoing(nodeId: string): string[] {
    const node = graph.nodes.get(nodeId)!;
    const outs = node.outgoing;
    if (outs.length === 0) return [];
    if (node.kind === "xor") {
      // una rama por probabilidad
      const weights = config.gateways[nodeId] ?? {};
      const ws = outs.map((f) => weights[f] ?? 1);
      const total = ws.reduce((s, w) => s + w, 0) || 1;
      let r = rng() * total;
      for (let i = 0; i < outs.length; i++) {
        r -= ws[i];
        if (r <= 0) return [outs[i]];
      }
      return [outs[outs.length - 1]];
    }
    if (node.kind === "or") {
      // subconjunto (>=1) por probabilidad independiente
      const weights = config.gateways[nodeId] ?? {};
      const chosen = outs.filter((f) => rng() < (weights[f] ?? 0.5));
      return chosen.length ? chosen : [outs[Math.floor(rng() * outs.length)]];
    }
    // and / start / task / event / passthrough → todas las salidas
    return outs;
  }

  function traverseFlow(caseId: number, flowId: string, time: number, tokenId: string) {
    const flow = graph.flows.get(flowId);
    if (!flow) return;
    const tEnd = time + config.transferTime;
    segments.push({ tokenId, caseId, kind: "flow", refId: flowId, tStart: time, tEnd });
    caseTransfer.set(caseId, (caseTransfer.get(caseId) ?? 0) + config.transferTime);
    pq.push(tEnd, () => arriveAtNode(caseId, flow.target, tEnd, flowId, tokenId));
  }

  function routeOut(caseId: number, nodeId: string, time: number, tokenId: string) {
    const chosen = chooseOutgoing(nodeId);
    chosen.forEach((flowId, i) => {
      const tk = i === 0 ? tokenId : `${tokenId}.${i}`;
      traverseFlow(caseId, flowId, time, tk);
    });
  }

  function arriveAtNode(caseId: number, nodeId: string, time: number, viaFlow: string | null, tokenId: string) {
    const node = graph.nodes.get(nodeId);
    if (!node) return;
    maxTime = Math.max(maxTime, time);

    const visits = (caseVisits.get(caseId) ?? 0) + 1;
    caseVisits.set(caseId, visits);
    if (visits > MAX_VISITS_PER_CASE) {
      if (warnings.length < 5) warnings.push(`Caso ${caseId} excedió ${MAX_VISITS_PER_CASE} pasos (¿bucle sin salida?).`);
      return;
    }

    // sincronización de join (AND/OR con varias entradas)
    const isJoin = (node.kind === "and" || node.kind === "or") && node.incoming.length > 1;
    if (isJoin && viaFlow) {
      const key = `${nodeId}|${caseId}`;
      let set = joinArrivals.get(key);
      if (!set) {
        set = new Set();
        joinArrivals.set(key, set);
      }
      set.add(viaFlow);
      // pequeño segmento de espera del token en el join
      segments.push({ tokenId, caseId, kind: "node", refId: nodeId, nodeKind: node.kind, tStart: time, tEnd: time + 0.01 });
      const required = node.kind === "and" ? node.incoming.length : set.size; // OR: avanza con lo recibido en este instante
      if (node.kind === "and" && set.size < required) return; // espera más ramas
      joinArrivals.delete(key);
      // continúa con un token unificado
      routeOut(caseId, nodeId, time, `${nodeId}.${caseId}.j`);
      return;
    }

    switch (node.kind) {
      case "end": {
        const start = caseStart.get(caseId) ?? time;
        cycleSamples.push(time - start); // reloj de pared (incluye noches/fines)
        // tiempo hábil = procesamiento + espera + traslado (sin gaps de calendario)
        const work = (caseProcessing.get(caseId) ?? 0) + (caseWaiting.get(caseId) ?? 0) + (caseTransfer.get(caseId) ?? 0);
        cycleWorkSamples.push(work);
        completed++;
        // token termina (sin segmento extra)
        return;
      }
      case "task": {
        const cfg = config.tasks[nodeId];
        const dist = cfg?.duration ?? config.defaultTask;
        const resName = cfg?.resource;
        const arriveT = time;
        seize(resName ?? "", arriveT, (startT) => {
          const dur = sample(dist, rng);
          const wait = startT - arriveT;
          // calendario: estira el procesamiento a través de horas hábiles
          const ttId = resName ? config.resources[resName]?.timetableId : undefined;
          const tt = ttId ? config.timetables?.[ttId] : undefined;
          const taskEnd = tt ? addWorkingMinutes(tt, startT, dur, baseDate) : startT + dur;

          // ── Carrera de eventos de borde ────────────────────────────────────
          // Cada boundary tiene una DURACIÓN; compite contra la de la tarea.
          // Gana el menor tiempo. Interrumpe (cancela la tarea) si cancelActivity.
          // Los no interruptores que disparan antes del fin lanzan un token paralelo.
          let winnerTime = taskEnd;
          let winnerBoundary: string | null = null; // boundary que interrumpe
          const nonInterrupting: Array<{ id: string; at: number }> = [];
          for (const bId of graph.boundaries.get(nodeId) ?? []) {
            const bDist = config.boundaries?.[bId];
            if (!bDist) continue; // sin duración configurada → nunca dispara
            const bNode = graph.nodes.get(bId);
            const at = startT + sample(bDist, rng);
            if (bNode?.interrupting === false) {
              if (at <= taskEnd) nonInterrupting.push({ id: bId, at });
            } else if (at < winnerTime) {
              winnerTime = at;
              winnerBoundary = bId;
            }
          }

          // el token permanece en la tarea hasta que termina o es interrumpido
          segments.push({
            tokenId,
            caseId,
            kind: "node",
            refId: nodeId,
            nodeKind: "task",
            tStart: arriveT,
            tEnd: winnerTime,
            active: true,
          });
          const effProc = winnerTime - startT; // duración real reloj (truncada si interrumpe)
          // tiempo de trabajo efectivo (sin contar noches/fines de semana)
          const workProc = winnerBoundary ? effProc : dur;
          const a = actOf(nodeId);
          a.visits++;
          a.totalProcessing += workProc;
          a.totalWaiting += wait;
          let visitCost = 0;
          if (resName && config.resources[resName]) {
            visitCost += (workProc / 60) * config.resources[resName].costPerHour;
          }
          visitCost += cfg?.fixedCost ?? 0;
          a.cost += visitCost;
          // umbrales: cuenta ejecuciones que superan duración/costo
          if (cfg?.durationThreshold != null && cfg.durationThreshold > 0 && workProc > cfg.durationThreshold) a.durOverThreshold++;
          if (cfg?.costThreshold != null && cfg.costThreshold > 0 && visitCost > cfg.costThreshold) a.costOverThreshold++;
          caseProcessing.set(caseId, (caseProcessing.get(caseId) ?? 0) + workProc);
          caseWaiting.set(caseId, (caseWaiting.get(caseId) ?? 0) + wait);

          // tokens paralelos de boundary NO interruptores (la tarea sigue)
          for (const ni of nonInterrupting) {
            const nb = graph.nodes.get(ni.id);
            actOf(ni.id).visits++;
            pq.push(ni.at, () => routeOut(caseId, ni.id, ni.at, `${tokenId}~${nb?.name || ni.id}`));
          }

          pq.push(winnerTime, () => {
            if (resName) release(resName, winnerTime);
            if (winnerBoundary) {
              // el evento de borde interrumpió: el token sale por la excepción
              actOf(winnerBoundary).visits++;
              routeOut(caseId, winnerBoundary, winnerTime, tokenId);
            } else {
              routeOut(caseId, nodeId, winnerTime, tokenId);
            }
          });
        });
        return;
      }
      case "event": {
        // evento intermedio/timer: si tiene demora configurada, el token espera
        const dist = config.delays?.[nodeId];
        if (dist) {
          const dur = sample(dist, rng);
          segments.push({ tokenId, caseId, kind: "node", refId: nodeId, nodeKind: "event", tStart: time, tEnd: time + dur });
          caseWaiting.set(caseId, (caseWaiting.get(caseId) ?? 0) + dur);
          const a = actOf(nodeId);
          a.visits++;
          a.totalWaiting += dur;
          pq.push(time + dur, () => routeOut(caseId, nodeId, time + dur, tokenId));
        } else {
          routeOut(caseId, nodeId, time, tokenId);
        }
        return;
      }
      // start / xor / and-split / passthrough → enrutar de inmediato
      default:
        routeOut(caseId, nodeId, time, tokenId);
        return;
    }
  }

  // ── Generación de llegadas ──────────────────────────────────────────────────
  if (graph.starts.length === 0) {
    warnings.push("No hay evento de inicio en el diagrama.");
  }
  let arrivalT = 0;
  // Acceso libre: sin límite artificial de instancias (sólo el tope de eventos
  // protege el navegador de bucles infinitos, devolviendo resultado parcial).
  const n = Math.max(1, Math.floor(config.instances));
  for (let i = 0; i < n; i++) {
    const caseId = i + 1;
    const at = arrivalT;
    for (const startId of graph.starts) {
      pq.push(at, () => {
        if (!caseStart.has(caseId)) {
          caseStart.set(caseId, at);
          started++;
        }
        arriveAtNode(caseId, startId, at, null, `c${caseId}`);
      });
    }
    arrivalT += sample(config.arrival, rng);
  }

  // ── Bucle de eventos ──────────────────────────────────────────────────────
  for (;;) {
    const ev = pq.pop();
    if (!ev) break;
    ev.fn();
    if (++eventCount > MAX_EVENTS) {
      warnings.push("Se alcanzó el límite de eventos; resultado parcial.");
      break;
    }
  }

  // cierra utilización de recursos al horizonte final
  const horizon = Math.max(maxTime, 1);
  const resources: ResourceStat[] = [];
  for (const [name, r] of res) {
    touchRes(r, horizon);
    const util = r.def.capacity > 0 ? r.busyTime / (r.def.capacity * horizon) : 0;
    resources.push({
      name,
      capacity: r.def.capacity,
      busyTime: r.busyTime,
      utilization: Math.min(1, util),
      cost: (r.busyTime / 60) * r.def.costPerHour,
    });
  }

  // ── Agregados (aplicando warmup: descarta las primeras instancias) ──────────
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const warmup = Math.max(0, Math.min(95, config.warmupPercent ?? 0));
  const drop = Math.floor((cycleSamples.length * warmup) / 100);
  const cycleKept = drop > 0 ? cycleSamples.slice(drop) : cycleSamples;
  const cycleWorkKept = drop > 0 ? cycleWorkSamples.slice(drop) : cycleWorkSamples;
  const procArr = [...caseProcessing.values()];
  const waitArr = [...caseWaiting.values()];
  const transArr = [...caseTransfer.values()];
  const avgCycle = avg(cycleKept);
  const avgProcessing = avg(procArr);
  // costo total = costo por tiempo de recurso + costos fijos de las actividades
  const totalCost = [...actStat.values()].reduce((s, a) => s + a.cost, 0);

  const activities = [...actStat.values()].sort((a, b) => b.totalProcessing - a.totalProcessing);

  return {
    segments: segments.sort((a, b) => a.tStart - b.tStart),
    maxTime,
    started,
    completed,
    avgCycle,
    minCycle: cycleKept.length ? Math.min(...cycleKept) : 0,
    maxCycle: cycleKept.length ? Math.max(...cycleKept) : 0,
    avgCycleExcl: avg(cycleWorkKept),
    minCycleExcl: cycleWorkKept.length ? Math.min(...cycleWorkKept) : 0,
    maxCycleExcl: cycleWorkKept.length ? Math.max(...cycleWorkKept) : 0,
    avgProcessing,
    avgWaiting: avg(waitArr),
    avgTransfer: avg(transArr),
    cycleEfficiency: avgCycle > 0 ? avgProcessing / avgCycle : 0,
    throughputPerHour: horizon > 0 ? (completed / horizon) * 60 : 0,
    totalCost,
    cycleSamples: cycleKept,
    activities,
    resources,
    warnings,
    currency: config.currency ?? "$",
  };
}
