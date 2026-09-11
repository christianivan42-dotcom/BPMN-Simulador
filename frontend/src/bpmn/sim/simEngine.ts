// ── Motor de simulación de eventos discretos (DES) basado en tokens ──────────
// Precomputa toda la corrida en "tiempo de simulación" (minutos) y produce:
//   1) una línea de tiempo de SEGMENTOS para animar (tokens recorriendo flujos
//      y permaneciendo en tareas), y
//   2) los KPIs cuantitativos del proceso: cycle time, waiting, processing,
//      utilización de recursos, costo, cycle-time efficiency.
//
// Con horarios de trabajo conviven dos relojes:
//   · reloj de pared — lo que vive la solicitud, noches y fines de semana
//     incluidos: cycle time, espera, inactividad y throughput;
//   · tiempo hábil — solo los minutos en que el recurso trabaja: proceso,
//     ocupación y costo de los recursos, y cycle time hábil.
//
// Convenciones: llegadas dentro del horario de llegadas, tareas que se pausan
// al cierre y se retoman, espera = cola en horas hábiles, inactividad = tiempo
// fuera de horario, utilización sobre las horas disponibles. Los recursos con
// TURNOS (dotación variable, relevo entre turnos) generalizan el horario: con un
// solo turno dan exactamente lo mismo.

import { sample, makeRng, type Distribution } from "./distributions";
import { addWorkingMinutes, nextWorkStart, workingMinutesBetween, type Timetable } from "./calendar";
import {
  capacityAt,
  headcount,
  nextCapacityChange,
  personMinutesBetween,
  staffedMinutesBetween,
  type Shift,
} from "./shifts";
import type { SimGraph } from "./simGraph";

export interface ResourceDef {
  capacity: number;
  costPerHour: number;
  /** Timetable asignado (horario laboral). Si falta → 24/7. */
  timetableId?: string;
  /**
   * Turnos con su propia dotación. Si hay turnos, sustituyen a `capacity` y a
   * `timetableId`: la capacidad pasa a depender de la hora y, al cambiar de turno,
   * las tareas a medias siguen con el turno entrante.
   */
  shifts?: Shift[];
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
  /**
   * Horario en el que se crean instancias. El reloj de llegadas solo avanza
   * dentro de él: con llegadas cada 120 min y horario 9-17, tras la de las 17:00
   * la siguiente es a las 11:00 del día hábil siguiente. Sin él, las llegadas son 24/7.
   */
  arrivalTimetableId?: string;
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
  /** Cola: tiempo esperando a que un recurso quede libre. */
  totalWaiting: number;
  /** Fuera de horario: antes de empezar o con la tarea a medias. */
  totalIdle: number;
  cost: number;
  /** Ejecuciones que superaron el umbral de duración / costo. */
  durOverThreshold: number;
  costOverThreshold: number;
}

export interface ResourceStat {
  name: string;
  /** Personas; con turnos, la dotación del turno más numeroso. */
  capacity: number;
  /** El recurso trabaja por turnos con dotación variable. */
  variableCapacity?: boolean;
  /** Minutos HÁBILES trabajados: no incluye las noches que una tarea deja a medias. */
  busyTime: number;
  /** busyTime / personas-minuto disponibles en el periodo simulado. */
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
  /** Cycle time en tiempo hábil: proceso + espera hábil + traslados + demoras
   *  de eventos. Descuenta las noches y fines de semana. */
  avgCycleExcl: number;
  minCycleExcl: number;
  maxCycleExcl: number;
  avgProcessing: number;
  /** Espera en cola (recurso ocupado) más las demoras de eventos. */
  avgWaiting: number;
  /** Inactividad fuera de horario. En un proceso secuencial:
   *  cycle = proceso + espera + inactividad + traslados. */
  avgIdle: number;
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
/** Tope de segmentos guardados para la animación. Cada segmento es un objeto en
 *  memoria; sin tope, una corrida grande agotaba la RAM de la pestaña antes de
 *  llegar a mostrar un solo KPI. Superado el tope se siguen calculando los KPIs
 *  pero se deja de grabar la película. */
const MAX_SEGMENTS = 200_000;

/** Mín/máx sobre arrays grandes.
 *  `Math.min(...arr)` revienta con "Maximum call stack size exceeded" a partir
 *  de ~100k elementos, y el escenario permite instancias sin límite. */
function minOf(arr: number[]): number {
  let m = Infinity;
  for (const x of arr) if (x < m) m = x;
  return Number.isFinite(m) ? m : 0;
}
function maxOf(arr: number[]): number {
  let m = -Infinity;
  for (const x of arr) if (x > m) m = x;
  return Number.isFinite(m) ? m : 0;
}

/** Una tarea atendida por un recurso con turnos. */
interface ShiftJob {
  /** Minutos de trabajo pendientes. */
  remaining: number;
  /** Último instante hasta el que están contabilizados sus tiempos. */
  lastT: number;
  state: "queued" | "active" | "done" | "cancelled";
  /** Cambia en cada pausa o reanudación: invalida los fines ya programados. */
  version: number;
  firstStart: number | null;
  work: number;
  wait: number;
  idle: number;
  onFirstStart: (t: number) => void;
  onDone: (t: number) => void;
}

export function runSimulation(graph: SimGraph, config: SimConfig): SimResult {
  const rng = makeRng(config.seed || 12345);
  const pq = new PQ();
  const segments: Segment[] = [];
  const warnings: string[] = [];
  let segmentsTruncated = false;

  // calendario base
  const baseDate = new Date(config.startDateMs ?? Date.now());

  /** Graba un segmento de la animación respetando MAX_SEGMENTS. */
  function pushSegment(seg: Segment) {
    if (segments.length < MAX_SEGMENTS) {
      segments.push(seg);
    } else if (!segmentsTruncated) {
      segmentsTruncated = true;
      warnings.push(
        `La animación se cortó en ${MAX_SEGMENTS.toLocaleString()} movimientos ` +
        "(los KPIs sí se calcularon sobre la corrida completa). Reduce el nº de instancias para verla entera.",
      );
    }
  }

  // estado de recursos
  interface ResState {
    def: ResourceDef;
    /** Horario del recurso; sin él trabaja 24/7. */
    tt?: Timetable;
    /** Turnos con dotación variable; si existen, mandan sobre capacidad y horario. */
    shifts?: Shift[];
    busy: number;
    /** Minutos hábiles trabajados (base de la utilización y del costo). */
    busyWork: number;
    queue: Array<(t: number) => void>;
    // Solo con turnos: tareas en curso, en cola y el próximo relevo vigilado.
    active: ShiftJob[];
    waiting: ShiftJob[];
    nextChange: number | null;
  }
  const res = new Map<string, ResState>();
  for (const [name, def] of Object.entries(config.resources)) {
    // Capacidad 0 (o vacía, que Number("") convierte en 0) dejaba a todos los
    // tokens encolados para siempre: la simulación terminaba con 0 instancias
    // completadas y sin ninguna explicación.
    let capacity = Math.floor(Number(def.capacity));
    let shifts = def.shifts?.length ? def.shifts : undefined;
    if (!shifts && (!Number.isFinite(capacity) || capacity < 1)) {
      warnings.push(`El recurso "${name}" tenía capacidad ${def.capacity}; se usó 1.`);
      capacity = 1;
    }
    // Unos turnos sin nadie dejarían las tareas esperando para siempre.
    if (shifts && personMinutesBetween(shifts, 0, 7 * 1440, baseDate) <= 0) {
      warnings.push(`El recurso "${name}" no tiene personas en ningún turno; se usó 1 persona 24/7.`);
      shifts = undefined;
      capacity = 1;
    }
    res.set(name, {
      def: { ...def, capacity: Number.isFinite(capacity) && capacity >= 1 ? capacity : 1, costPerHour: Number(def.costPerHour) || 0 },
      tt: !shifts && def.timetableId ? config.timetables?.[def.timetableId] : undefined,
      shifts,
      busy: 0, busyWork: 0, queue: [],
      active: [], waiting: [], nextChange: null,
    });
  }
  function seize(name: string, now: number, cb: (start: number) => void) {
    const r = res.get(name);
    if (!r) {
      cb(now);
      return;
    }
    if (r.busy < r.def.capacity) {
      r.busy++;
      cb(now);
    } else {
      r.queue.push((t) => {
        r.busy++;
        cb(t);
      });
    }
  }
  function release(name: string, now: number) {
    const r = res.get(name);
    if (!r) return;
    r.busy--;
    const next = r.queue.shift();
    if (next) next(now);
  }

  // ── Recursos con turnos ─────────────────────────────────────────────────────
  // La capacidad cambia con la hora, así que el fin de una tarea no se conoce al
  // empezarla: se programa y se invalida (versión) si un relevo la pausa.

  /** Contabiliza el tiempo en cola: con alguien en turno es espera; sin nadie,
   *  inactividad (la misma regla que para la cola que cruza la noche). */
  function settleQueued(r: ResState, job: ShiftJob, now: number) {
    const dt = now - job.lastT;
    if (dt > 0) {
      const staffed = staffedMinutesBetween(r.shifts!, job.lastT, now, baseDate);
      job.wait += staffed;
      job.idle += dt - staffed;
    }
    job.lastT = now;
  }

  function settleActive(job: ShiftJob, now: number) {
    const done = Math.min(now - job.lastT, job.remaining);
    if (done > 0) {
      job.remaining -= done;
      job.work += done;
    }
    job.lastT = now;
  }

  function complete(r: ResState, job: ShiftJob) {
    job.state = "done";
    job.version++;
    const i = r.active.indexOf(job);
    if (i >= 0) r.active.splice(i, 1);
    r.busyWork += job.work;
  }

  function activate(r: ResState, job: ShiftJob, now: number) {
    settleQueued(r, job, now);
    job.state = "active";
    const version = ++job.version;
    r.active.push(job);
    if (job.firstStart === null) {
      job.firstStart = now;
      job.onFirstStart(now);
    }
    const end = now + job.remaining;
    pq.push(end, () => {
      if (job.version !== version || job.state !== "active") return;
      settleActive(job, end);
      complete(r, job);
      fill(r, end);
      job.onDone(end);
    });
  }

  /** Pone a trabajar tantas tareas en cola como personas libres haya en turno. */
  function fill(r: ResState, now: number) {
    const capacity = capacityAt(r.shifts!, now, baseDate);
    while (r.active.length < capacity && r.waiting.length) {
      activate(r, r.waiting.shift()!, now);
    }
    watchShiftChange(r, now);
  }

  /** Programa el próximo relevo, solo mientras haya tareas pendientes. */
  function watchShiftChange(r: ResState, now: number) {
    if (!r.active.length && !r.waiting.length) return;
    if (r.nextChange !== null && r.nextChange >= now) return;
    const at = nextCapacityChange(r.shifts!, now, baseDate);
    if (!Number.isFinite(at)) return;
    r.nextChange = at;
    pq.push(at, () => {
      if (r.nextChange !== at) return;
      r.nextChange = null;
      shiftChange(r, at);
    });
  }

  function shiftChange(r: ResState, t: number) {
    const finished: ShiftJob[] = [];
    for (const job of [...r.active]) {
      settleActive(job, t);
      if (job.remaining <= 1e-9) {
        complete(r, job);
        finished.push(job);
      }
    }
    const capacity = capacityAt(r.shifts!, t, baseDate);
    if (r.active.length > capacity) {
      // Relevo con menos personas: las tareas empezadas más tarde vuelven a la
      // cola, por delante de las que aún no han empezado.
      const paused = r.active.splice(capacity);
      for (const job of paused) {
        job.state = "queued";
        job.version++;
        job.lastT = t;
      }
      r.waiting.unshift(...paused);
    }
    fill(r, t);
    for (const job of finished) job.onDone(t);
  }

  function submit(r: ResState, job: ShiftJob, now: number) {
    job.lastT = now;
    r.waiting.push(job);
    fill(r, now);
  }

  /** Cancela una tarea (evento de borde interruptor). false si ya había acabado. */
  function cancel(r: ResState, job: ShiftJob, now: number): boolean {
    if (job.state === "done" || job.state === "cancelled") return false;
    if (job.state === "active") {
      settleActive(job, now);
      r.active.splice(r.active.indexOf(job), 1);
    } else {
      settleQueued(r, job, now);
      r.waiting.splice(r.waiting.indexOf(job), 1);
    }
    job.state = "cancelled";
    job.version++;
    r.busyWork += job.work;
    fill(r, now);
    return true;
  }

  // estadísticas
  const caseStart = new Map<number, number>();
  const caseProcessing = new Map<number, number>();
  const caseWaiting = new Map<number, number>();
  const caseIdle = new Map<number, number>();
  /** Espera medida en tiempo hábil (para el cycle time hábil). */
  const caseWaitWork = new Map<number, number>();
  const caseTransfer = new Map<number, number>();
  const caseVisits = new Map<number, number>();
  // Una instancia se cierra UNA sola vez, aunque le lleguen varios tokens al
  // final (típico con compuertas paralelas sin join). Antes cada token sumaba a
  // `completed` y metía su propia muestra de cycle time, así que el panel podía
  // mostrar "150 / 100 completadas" e inflar el throughput.
  const caseDone = new Map<number, { cycle: number; work: number }>();
  const doneOrder: number[] = [];
  const actStat = new Map<string, ActivityStat>();
  let started = 0;
  let maxTime = 0;
  let eventCount = 0;

  function actOf(nodeId: string): ActivityStat {
    let a = actStat.get(nodeId);
    if (!a) {
      const n = graph.nodes.get(nodeId);
      a = {
        id: nodeId, name: n?.name || nodeId, visits: 0,
        totalProcessing: 0, totalWaiting: 0, totalIdle: 0, cost: 0,
        durOverThreshold: 0, costOverThreshold: 0,
      };
      actStat.set(nodeId, a);
    }
    return a;
  }

  /** Suma las estadísticas de una ejecución de tarea ya terminada. */
  function recordTask(caseId: number, nodeId: string, cfg: TaskConfig | undefined, r: ResState | undefined, work: number, wait: number, idle: number) {
    const a = actOf(nodeId);
    a.visits++;
    a.totalProcessing += work;
    a.totalWaiting += wait;
    a.totalIdle += idle;
    let visitCost = 0;
    if (r) visitCost += (work / 60) * r.def.costPerHour;
    visitCost += cfg?.fixedCost ?? 0;
    a.cost += visitCost;
    // umbrales: cuenta ejecuciones que superan duración/costo
    if (cfg?.durationThreshold != null && cfg.durationThreshold > 0 && work > cfg.durationThreshold) a.durOverThreshold++;
    if (cfg?.costThreshold != null && cfg.costThreshold > 0 && visitCost > cfg.costThreshold) a.costOverThreshold++;
    caseProcessing.set(caseId, (caseProcessing.get(caseId) ?? 0) + work);
    caseWaiting.set(caseId, (caseWaiting.get(caseId) ?? 0) + wait);
    caseIdle.set(caseId, (caseIdle.get(caseId) ?? 0) + idle);
    caseWaitWork.set(caseId, (caseWaitWork.get(caseId) ?? 0) + wait);
  }

  // sincronización de joins AND/OR: clave `${nodeId}|${caseId}` -> set de flows llegados
  const joinArrivals = new Map<string, Set<string>>();
  // Por caso: cuántas ramas abrió cada inclusiva, apiladas. El join inclusivo
  // que la cierra espera exactamente a esas ramas.
  const orActivated = new Map<number, number[]>();

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
    pushSegment({ tokenId, caseId, kind: "flow", refId: flowId, tStart: time, tEnd });
    caseTransfer.set(caseId, (caseTransfer.get(caseId) ?? 0) + config.transferTime);
    pq.push(tEnd, () => arriveAtNode(caseId, flow.target, tEnd, flowId, tokenId));
  }

  function routeOut(caseId: number, nodeId: string, time: number, tokenId: string) {
    const chosen = chooseOutgoing(nodeId);
    const node = graph.nodes.get(nodeId);
    if (node?.kind === "or" && node.outgoing.length > 1) {
      const stack = orActivated.get(caseId) ?? [];
      stack.push(chosen.length);
      orActivated.set(caseId, stack);
    }
    chosen.forEach((flowId, i) => {
      const tk = i === 0 ? tokenId : `${tokenId}.${i}`;
      traverseFlow(caseId, flowId, time, tk);
    });
  }

  /** Tarea atendida por un recurso con turnos: dotación variable y relevo. */
  function runShiftTask(
    caseId: number, nodeId: string, tokenId: string, arriveT: number,
    r: ResState, cfg: TaskConfig | undefined, dist: Distribution,
  ) {
    const finish = (t: number, via: string | null) => {
      pushSegment({ tokenId, caseId, kind: "node", refId: nodeId, nodeKind: "task", tStart: arriveT, tEnd: t, active: true });
      recordTask(caseId, nodeId, cfg, r, job.work, job.wait, job.idle);
      if (via) {
        actOf(via).visits++;
        routeOut(caseId, via, t, tokenId);
      } else {
        routeOut(caseId, nodeId, t, tokenId);
      }
    };

    // Los eventos de borde compiten desde que empieza el trabajo, igual que en
    // las tareas con horario simple.
    const scheduleBoundaries = (startT: number) => {
      for (const bId of graph.boundaries.get(nodeId) ?? []) {
        const bDist = config.boundaries?.[bId];
        if (!bDist) continue;
        const bNode = graph.nodes.get(bId);
        const at = startT + sample(bDist, rng);
        if (bNode?.interrupting === false) {
          pq.push(at, () => {
            if (job.state === "done" || job.state === "cancelled") return;
            actOf(bId).visits++;
            routeOut(caseId, bId, at, `${tokenId}~${bNode?.name || bId}`);
          });
        } else {
          pq.push(at, () => {
            if (cancel(r, job, at)) finish(at, bId);
          });
        }
      }
    };

    const job: ShiftJob = {
      remaining: sample(dist, rng),
      lastT: arriveT,
      state: "queued",
      version: 0,
      firstStart: null,
      work: 0,
      wait: 0,
      idle: 0,
      onFirstStart: scheduleBoundaries,
      onDone: (t) => finish(t, null),
    };
    submit(r, job, arriveT);
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
      pushSegment({ tokenId, caseId, kind: "node", refId: nodeId, nodeKind: node.kind, tStart: time, tEnd: time + 0.01 });
      // AND espera a todas sus entradas; OR, a las ramas que abrió su split.
      // Antes el OR avanzaba con cada token que llegaba y repetía todo lo que
      // venía después: visitas, tiempo y costo duplicados.
      const stack = node.kind === "or" ? orActivated.get(caseId) : undefined;
      const required = node.kind === "and"
        ? node.incoming.length
        : Math.min(node.incoming.length, stack?.length ? stack[stack.length - 1] : 1);
      if (set.size < required) return; // espera más ramas
      if (stack?.length) stack.pop();
      joinArrivals.delete(key);
      // continúa con un token unificado
      routeOut(caseId, nodeId, time, `${nodeId}.${caseId}.j`);
      return;
    }

    switch (node.kind) {
      case "end": {
        const start = caseStart.get(caseId) ?? time;
        const cycle = time - start; // reloj de pared (incluye noches/fines)
        // tiempo hábil = procesamiento + espera hábil + traslado
        const work = (caseProcessing.get(caseId) ?? 0) + (caseWaitWork.get(caseId) ?? 0) + (caseTransfer.get(caseId) ?? 0);
        const prev = caseDone.get(caseId);
        if (!prev) {
          doneOrder.push(caseId);
          caseDone.set(caseId, { cycle, work });
        } else if (cycle > prev.cycle) {
          // La instancia acaba cuando termina su ÚLTIMA rama, no la primera.
          prev.cycle = cycle;
          prev.work = work;
        }
        // token termina (sin segmento extra)
        return;
      }
      case "task": {
        const cfg = config.tasks[nodeId];
        const dist = cfg?.duration ?? config.defaultTask;
        const resName = cfg?.resource;
        const r = resName ? res.get(resName) : undefined;
        if (r?.shifts) {
          runShiftTask(caseId, nodeId, tokenId, time, r, cfg, dist);
          return;
        }
        const tt = r?.tt;
        const arriveT = time;
        seize(resName ?? "", arriveT, (startT) => {
          const dur = sample(dist, rng);
          // Con horario, el trabajo arranca cuando abre el turno; mientras tanto
          // la solicitud está inactiva. Antes "empezaba" fuera de horario y esas
          // horas no aparecían en ningún indicador.
          const workStart = tt ? nextWorkStart(tt, startT, baseDate) : startT;
          // Espera = cola medida en horas hábiles del recurso: si la
          // cola cruza la noche, esas horas son inactividad y no espera.
          const wait = tt ? workingMinutesBetween(tt, arriveT, workStart, baseDate) : workStart - arriveT;
          // calendario: la tarea se pausa al cierre y se retoma al abrir
          const taskEnd = tt ? addWorkingMinutes(tt, workStart, dur, baseDate) : workStart + dur;

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
            const at = workStart + sample(bDist, rng);
            if (bNode?.interrupting === false) {
              nonInterrupting.push({ id: bId, at });
            } else if (at < winnerTime) {
              winnerTime = at;
              winnerBoundary = bId;
            }
          }
          // Un no interruptor solo dispara mientras la tarea sigue viva: si otro
          // evento la canceló antes, su rama ya no debe existir.
          const fired = nonInterrupting.length
            ? nonInterrupting.filter((ni) => ni.at <= winnerTime)
            : nonInterrupting;

          // el token permanece en la tarea hasta que termina o es interrumpido
          pushSegment({
            tokenId,
            caseId,
            kind: "node",
            refId: nodeId,
            nodeKind: "task",
            tStart: arriveT,
            tEnd: winnerTime,
            active: true,
          });
          // tiempo de trabajo efectivo en minutos hábiles (truncado si interrumpe)
          const workProc = winnerBoundary
            ? (tt ? workingMinutesBetween(tt, workStart, winnerTime, baseDate) : winnerTime - workStart)
            : dur;
          // Inactividad = el resto del tiempo en la actividad que no es cola ni
          // trabajo: fuera de horario antes de empezar y noches con la tarea a medias.
          const idle = Math.max(0, winnerTime - arriveT - wait - workProc);
          if (r) r.busyWork += workProc;
          recordTask(caseId, nodeId, cfg, r, workProc, wait, idle);

          // tokens paralelos de boundary NO interruptores (la tarea sigue)
          for (const ni of fired) {
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
          pushSegment({ tokenId, caseId, kind: "node", refId: nodeId, nodeKind: "event", tStart: time, tEnd: time + dur });
          caseWaiting.set(caseId, (caseWaiting.get(caseId) ?? 0) + dur);
          // Una demora de evento ("esperar 3 días") es calendario real: también
          // cuenta en el cycle time hábil.
          caseWaitWork.set(caseId, (caseWaitWork.get(caseId) ?? 0) + dur);
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
  // Las instancias solo se crean dentro del horario de llegadas: el tiempo entre
  // llegadas corre en minutos de ese horario. Sin horario de llegadas, 24/7.
  const arrivalTt = config.arrivalTimetableId ? config.timetables?.[config.arrivalTimetableId] : undefined;
  let arrivalT = arrivalTt ? nextWorkStart(arrivalTt, 0, baseDate) : 0;
  // Acceso libre: sin límite artificial de instancias (sólo el tope de eventos
  // protege el navegador de bucles infinitos, devolviendo resultado parcial).
  // `Number("")` es 0 y un campo mal escrito puede dar NaN: sin saneado el
  // bucle no llegaba a ejecutarse y la simulación salía vacía sin avisar.
  const requested = Math.floor(Number(config.instances));
  const n = Number.isFinite(requested) && requested > 0 ? requested : 1;
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
    const gap = sample(config.arrival, rng);
    arrivalT = arrivalTt ? addWorkingMinutes(arrivalTt, arrivalT, gap, baseDate) : arrivalT + gap;
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

  // ── Recursos: ocupación y costo en tiempo hábil ─────────────────────────────
  // La ocupación se integraba en reloj de pared: una tarea que cruzaba la noche
  // dejaba el recurso "ocupado" 16 h, que se facturaban y contaban como uso. Ahora
  // se acumula el trabajo real y se compara con las personas-minuto disponibles
  // dentro del horizonte simulado.
  const horizon = Math.max(maxTime, 1);
  const resources: ResourceStat[] = [];
  for (const [name, r] of res) {
    const available = r.shifts
      ? personMinutesBetween(r.shifts, 0, horizon, baseDate)
      : r.def.capacity * (r.tt ? workingMinutesBetween(r.tt, 0, horizon, baseDate) : horizon);
    const util = available > 0 ? r.busyWork / available : 0;
    resources.push({
      name,
      capacity: r.shifts ? Math.max(0, ...r.shifts.map(headcount)) : r.def.capacity,
      variableCapacity: Boolean(r.shifts),
      busyTime: r.busyWork,
      utilization: Math.min(1, util),
      cost: (r.busyWork / 60) * r.def.costPerHour,
    });
  }

  // ── Agregados (aplicando warmup: descarta las primeras instancias) ──────────
  // Todos los promedios se calculan sobre EXACTAMENTE las mismas instancias.
  // Antes el warmup solo recortaba el cycle time mientras que procesamiento y
  // espera se promediaban sobre todas las instancias (incluidas las que nunca
  // terminaron), así que la "eficiencia = proc/cycle" mezclaba poblaciones y
  // podía dar más del 100 %.
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const warmup = Math.max(0, Math.min(95, Number(config.warmupPercent) || 0));
  const drop = Math.floor((doneOrder.length * warmup) / 100);
  const keptCases = drop > 0 ? doneOrder.slice(drop) : doneOrder;
  const completed = doneOrder.length;
  const cycleKept = keptCases.map((id) => caseDone.get(id)!.cycle);
  const cycleWorkKept = keptCases.map((id) => caseDone.get(id)!.work);
  const procArr = keptCases.map((id) => caseProcessing.get(id) ?? 0);
  const waitArr = keptCases.map((id) => caseWaiting.get(id) ?? 0);
  const idleArr = keptCases.map((id) => caseIdle.get(id) ?? 0);
  const transArr = keptCases.map((id) => caseTransfer.get(id) ?? 0);
  const avgCycle = avg(cycleKept);
  const avgProcessing = avg(procArr);
  // costo total = costo por tiempo de recurso + costos fijos de las actividades
  const totalCost = [...actStat.values()].reduce((s, a) => s + a.cost, 0);

  const activities = [...actStat.values()].sort((a, b) => b.totalProcessing - a.totalProcessing);

  // Un resultado vacío suele confundirse con "la app no funciona". Se explica.
  if (started > 0 && completed === 0) {
    warnings.push(
      "Ninguna instancia llegó a un evento de fin. Revisa que el diagrama tenga " +
      "End Event y que todas las tareas y compuertas queden conectadas.",
    );
  }

  return {
    segments: segments.sort((a, b) => a.tStart - b.tStart),
    maxTime,
    started,
    completed,
    avgCycle,
    minCycle: minOf(cycleKept),
    maxCycle: maxOf(cycleKept),
    avgCycleExcl: avg(cycleWorkKept),
    minCycleExcl: minOf(cycleWorkKept),
    maxCycleExcl: maxOf(cycleWorkKept),
    avgProcessing,
    avgWaiting: avg(waitArr),
    avgIdle: avg(idleArr),
    avgTransfer: avg(transArr),
    // La eficiencia es una fracción del cycle time: no puede pasar de 1.
    cycleEfficiency: avgCycle > 0 ? Math.min(1, avgProcessing / avgCycle) : 0,
    throughputPerHour: horizon > 0 ? (completed / horizon) * 60 : 0,
    totalCost,
    cycleSamples: cycleKept,
    activities,
    resources,
    warnings,
    currency: config.currency ?? "$",
  };
}
