// ── Análisis automático de la simulación ─────────────────────────────────────
// Lee los resultados como lo haría un analista de procesos y cuantifica cada
// mejora RE-SIMULANDO el mismo escenario con el cambio aplicado (misma semilla y
// mismas llegadas). Así el diagnóstico, la propuesta de TO-BE y el veredicto no
// dependen de que haya un modelo de lenguaje disponible; cuando lo hay, estas
// cifras le sirven de base para que no invente números.

import { workingMinutesBetween } from "./calendar";
import { personMinutesBetween } from "./shifts";
import { runSimulation, type SimConfig, type SimResult } from "./simEngine";
import type { SimGraph, SimNode } from "./simGraph";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type Severity = "alta" | "media" | "baja";

export type FindingKind =
  | "eficiencia"
  | "espera"
  | "horario"
  | "retrabajo"
  | "saturacion"
  | "cola"
  | "manual"
  | "costo";

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  title: string;
  /** Cifras que sostienen el hallazgo. */
  evidence: string;
  elementIds: string[];
}

/** Indicadores medios por solicitud de una corrida. */
export interface Kpis {
  completed: number;
  started: number;
  cycle: number;
  cycleExcl: number;
  processing: number;
  /** Cola por recurso ocupado y demoras de eventos. */
  waiting: number;
  /** Tiempo parado fuera de horario. */
  idle: number;
  efficiency: number;
  throughputPerHour: number;
  totalCost: number;
  costPerCase: number;
  maxUtilization: number;
}

export type LeverKind = "eliminar-retrabajo" | "quitar-espera" | "automatizar" | "ampliar-capacidad";

export interface Lever {
  kind: LeverKind;
  title: string;
  /** Cómo llevarlo a la práctica. */
  how: string;
  /** Qué cambia en el diagrama del TO-BE. */
  diagram: string;
  elementIds: string[];
  /** Indicadores re-simulados con este cambio aplicado. */
  after: Kpis;
  /** Costo que la simulación no ve, como el sueldo de una plaza nueva. */
  extraCost?: number;
}

export interface ScenarioAnalysis {
  processName: string;
  scenarioLabel: string;
  currency: string;
  /** Indicadores de la corrida real. */
  kpis: Kpis;
  /** Base con la que se comparan las palancas (mismas instancias que ellas). */
  baseline: Kpis;
  findings: Finding[];
  /** Palancas de mayor a menor reducción del cycle time. */
  levers: Lever[];
  /** Rediseño con el mismo equipo: todas las palancas salvo contratar. */
  combined: Kpis | null;
  whatIfInstances: number;
}

/** Datos de un escenario ya simulado (lo que el panel guarda para comparar). */
export interface ScenarioData {
  name: string;
  currency: string;
  completed: number;
  started: number;
  avgCycle: number;
  avgCycleExcl: number;
  avgProcessing: number;
  avgWaiting: number;
  /** Opcional: los datos guardados por versiones anteriores no lo traen. */
  avgIdle?: number;
  cycleEfficiency: number;
  throughputPerHour: number;
  totalCost: number;
  activities: Array<{ name: string; visits: number; proc: number; wait: number; cost: number }>;
  resources: Array<{ name: string; capacity: number; utilization: number; cost: number }>;
}

export type Decision = "implementar" | "implementar-con-ajustes" | "no-implementar";

export interface Comparison {
  asis: ScenarioData;
  tobe: ScenarioData;
  /** [indicador, AS-IS, TO-BE, cambio] ya formateados. */
  rows: Array<[string, string, string, string]>;
  /** Cambios relativos (−0.4 = −40 %). */
  cycleChange: number;
  waitChange: number;
  costPerCaseChange: number;
  decision: Decision;
  risks: string[];
}

// ── Umbrales ─────────────────────────────────────────────────────────────────
// Convenciones habituales en mejora de procesos, no leyes: por encima del 85 %
// de utilización las colas crecen muy deprisa ante cualquier pico.
const SATURATION = 0.85;
const POLICY_WAIT_SHARE = 0.15;
const IDLE_SHARE = 0.3;
const LOW_EFFICIENCY = 0.25;
const QUEUE_SHARE = 0.05;
const MANUAL_SHARE = 0.15;
const COST_CONCENTRATION = 0.4;
/** Una mejora cuenta si baja al menos un 10 %; un empeoramiento, si sube un 5 %. */
const BETTER = 0.1;
const WORSE = 0.05;
/** Tope de instancias para los "¿y si…?": cada palanca es una corrida completa. */
const WHAT_IF_MAX_INSTANCES = 3000;
/** Duración con la que se simula una tarea automatizada (min). */
const AUTOMATED_TASK_MIN = 2;

const AUTOMATED_TYPES = new Set([
  "bpmn:ServiceTask",
  "bpmn:ScriptTask",
  "bpmn:BusinessRuleTask",
  "bpmn:SendTask",
  "bpmn:ReceiveTask",
]);

// ── Formato ──────────────────────────────────────────────────────────────────

/** Duración legible. Redondea antes de partir en unidades: nunca "1h 60m". */
export function fmtDuration(min: number): string {
  if (!(min > 0)) return "0.0 min";
  if (min < 59.95) return `${min.toFixed(1)} min`;
  const total = Math.round(min);
  if (total < 1440) return `${Math.floor(total / 60)}h ${total % 60}m`;
  const hours = Math.round(min / 60);
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Porcentaje con un decimal por debajo del 10 %, para que coincida con el panel. */
const pctOf = (x: number) => {
  const v = Math.min(Math.max(x, 0), 10) * 100;
  return `${v < 10 ? v.toFixed(1) : v.toFixed(0)} %`;
};
const money = (v: number, currency: string) => `${currency} ${(v || 0).toFixed(2)}`;
const quote = (s: string) => `«${s}»`;
const ratio = (before: number, after: number) => (Math.abs(before) > 1e-9 ? (after - before) / Math.abs(before) : 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Cambio relativo con signo: "−25 %", "+4 %" o "=" si no cambia. */
function change(before: number, after: number): string {
  if (!(Math.abs(before) > 1e-9)) return after > 1e-9 ? "nuevo" : "=";
  const p = ratio(before, after) * 100;
  if (Math.abs(p) < 0.5) return "=";
  return `${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(0)} %`;
}

/** Diferencia en puntos porcentuales: "+12.3 pp". */
function points(before: number, after: number): string {
  const d = (after - before) * 100;
  if (Math.abs(d) < 0.05) return "=";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pp`;
}

/** "a, b, c y 2 más" */
function listOf(items: string[], max: number): string {
  return items.length > max ? `${items.slice(0, max).join(", ")} y ${items.length - max} más` : items.join(", ");
}

// ── Indicadores ──────────────────────────────────────────────────────────────

export function kpisOf(r: SimResult): Kpis {
  return {
    completed: r.completed,
    started: r.started,
    cycle: r.avgCycle,
    cycleExcl: r.avgCycleExcl,
    processing: r.avgProcessing,
    waiting: r.avgWaiting,
    idle: r.avgIdle,
    efficiency: r.cycleEfficiency,
    throughputPerHour: r.throughputPerHour,
    totalCost: r.totalCost,
    costPerCase: r.completed ? r.totalCost / r.completed : 0,
    maxUtilization: r.resources.reduce((m, x) => Math.max(m, x.utilization), 0),
  };
}

// ── Grafo ────────────────────────────────────────────────────────────────────

const nameOf = (graph: SimGraph, id: string) => graph.nodes.get(id)?.name || id;

/** Sucesores de un nodo, incluidas las salidas por sus eventos de borde. */
function successors(graph: SimGraph, id: string): string[] {
  const n = graph.nodes.get(id);
  if (!n) return [];
  const out = n.outgoing
    .map((f) => graph.flows.get(f)?.target)
    .filter((x): x is string => Boolean(x));
  out.push(...(graph.boundaries.get(id) ?? []));
  return out;
}

function reachableFrom(graph: SimGraph, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of successors(graph, id)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Nombre de una rama; los nombres numéricos son probabilidades, no etiquetas. */
function branchLabel(graph: SimGraph, flowId: string): string {
  const f = graph.flows.get(flowId);
  if (!f) return flowId;
  const label = f.name.trim();
  const target = nameOf(graph, f.target);
  return label && !/^\d*\.?\d+$/.test(label) ? `${label} → ${target}` : `→ ${target}`;
}

interface ReworkLoop {
  gateway: SimNode;
  flowId: string;
  /** Probabilidad de la rama que vuelve atrás. */
  share: number;
  taskIds: string[];
}

/** Ramas de compuertas exclusivas que devuelven el caso a un paso anterior. */
function findReworkLoops(graph: SimGraph, config: SimConfig): ReworkLoop[] {
  const cache = new Map<string, Set<string>>();
  const reach = (id: string) => {
    let s = cache.get(id);
    if (!s) {
      s = reachableFrom(graph, id);
      cache.set(id, s);
    }
    return s;
  };

  const loops: ReworkLoop[] = [];
  for (const g of graph.nodes.values()) {
    if (g.kind !== "xor" || g.outgoing.length < 2) continue;
    const weights = config.gateways[g.id] ?? {};
    const ws = g.outgoing.map((f) => weights[f] ?? 1);
    const total = ws.reduce((s, w) => s + w, 0) || 1;

    const back = g.outgoing
      .map((flowId, i) => ({ flowId, share: ws[i] / total, target: graph.flows.get(flowId)?.target }))
      .filter((b): b is { flowId: string; share: number; target: string } =>
        Boolean(b.target) && reach(b.target!).has(g.id));
    // Si todas las ramas vuelven atrás no hay salida: es un ciclo, no retrabajo.
    if (back.length === 0 || back.length === g.outgoing.length) continue;

    for (const b of back) {
      if (b.share <= 0) continue;
      const taskIds = [...reach(b.target)]
        .filter((id) => graph.nodes.get(id)?.kind === "task" && reach(id).has(g.id));
      loops.push({ gateway: g, flowId: b.flowId, share: b.share, taskIds });
    }
  }
  return loops.sort((a, b) => b.share - a.share);
}

// ── Palancas ─────────────────────────────────────────────────────────────────

interface LeverPlan extends Omit<Lever, "after"> {
  patch: (c: SimConfig) => SimConfig;
  /** Entra en el rediseño combinado (contratar no es rediseñar el proceso). */
  redesign: boolean;
}

/** Costo de la dotación extra que propone la palanca de capacidad. */
function extraCapacityCost(config: SimConfig, result: SimResult, name: string): number {
  const def = config.resources[name];
  if (!def) return 0;
  const base = new Date(config.startDateMs ?? 0);
  const rate = Number(def.costPerHour) || 0;
  if (def.shifts?.length) {
    // Una persona más en cada turno: se paga cada minuto de cada turno.
    const oneEach = def.shifts.map((s) => ({ ...s, capacity: 1 }));
    return (personMinutesBetween(oneEach, 0, result.maxTime, base) / 60) * rate;
  }
  const tt = def.timetableId ? config.timetables?.[def.timetableId] : undefined;
  const minutes = tt ? workingMinutesBetween(tt, 0, result.maxTime, base) : result.maxTime;
  return (minutes / 60) * rate;
}

// ── Diagnóstico del escenario ────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { alta: 0, media: 1, baja: 2 };

export function analyzeScenario(input: {
  graph: SimGraph;
  config: SimConfig;
  result: SimResult;
  processName?: string;
  scenarioLabel?: string;
}): ScenarioAnalysis {
  const { graph, config, result } = input;
  const currency = result.currency;
  const kpis = kpisOf(result);
  const started = Math.max(1, result.started);
  const findings: Finding[] = [];
  const plans: LeverPlan[] = [];

  // 1. Eficiencia de flujo
  const lowEfficiency = kpis.cycle > 0 && kpis.efficiency < LOW_EFFICIENCY;
  if (lowEfficiency) {
    findings.push({
      kind: "eficiencia",
      severity: kpis.efficiency < 0.1 ? "alta" : "media",
      title: "La solicitud pasa la mayor parte del tiempo esperando",
      evidence:
        `De ${fmtDuration(kpis.cycle)} de cycle time, solo ${fmtDuration(kpis.processing)} es trabajo ` +
        `(eficiencia ${pctOf(kpis.efficiency)}). El resto es cola, noches, fines de semana y esperas fijas.`,
      elementIds: [],
    });
  }

  // 2. Esperas fijas: eventos con demora que marcan el ritmo
  const policyWaits = result.activities
    .filter((a) => graph.nodes.get(a.id)?.kind === "event" && a.totalWaiting > 0)
    .map((a) => {
      const perCase = a.totalWaiting / started;
      return { a, perCase, share: kpis.cycle > 0 ? perCase / kpis.cycle : 0 };
    })
    .filter((w) => w.share >= POLICY_WAIT_SHARE)
    .sort((x, y) => y.share - x.share);
  for (const w of policyWaits) {
    findings.push({
      kind: "espera",
      severity: w.share >= 0.4 ? "alta" : "media",
      title: `La espera ${quote(w.a.name)} fija el ritmo del proceso`,
      evidence: `Añade ${fmtDuration(w.perCase)} a cada solicitud: el ${pctOf(w.share)} del cycle time.`,
      elementIds: [w.a.id],
    });
  }
  if (policyWaits[0]) {
    const { a } = policyWaits[0];
    plans.push({
      kind: "quitar-espera",
      title: `Eliminar la espera ${quote(a.name)}`,
      how:
        "Que la decisión no dependa de una sesión o de un plazo fijo: aprobación delegada por " +
        "nivel de riesgo, o sesiones diarias para los casos que sí la necesiten.",
      diagram: `Sacar ${quote(a.name)} de la ruta principal: solo pasan por ella los casos excepcionales.`,
      elementIds: [a.id],
      redesign: true,
      patch: (c) => {
        const delays = { ...(c.delays ?? {}) };
        delete delays[a.id];
        return { ...c, delays };
      },
    });
  }

  // 3. Horario laboral: tiempo parado fuera de turno
  const idleShare = kpis.cycle > 0 ? kpis.idle / kpis.cycle : 0;
  if (idleShare >= IDLE_SHARE) {
    findings.push({
      kind: "horario",
      severity: idleShare >= 0.5 ? "alta" : "media",
      title: "El horario laboral detiene el proceso",
      evidence:
        `Cada solicitud pasa ${fmtDuration(kpis.idle)} parada fuera de horario (el ${pctOf(idleShare)} del ` +
        "cycle time): noches, fines de semana o tareas que quedan a medias al cierre.",
      elementIds: [],
    });
  }

  // 4. Retrabajo
  const loops = findReworkLoops(graph, config);
  const visitsOf = (id: string) => result.activities.find((x) => x.id === id)?.visits ?? 0;
  for (const loop of loops) {
    const repeated = loop.taskIds
      .map((id) => `${quote(nameOf(graph, id))} ${visitsOf(id)} veces`)
      .join(", ");
    findings.push({
      kind: "retrabajo",
      severity: loop.share >= 0.2 ? "alta" : "media",
      title: `Retrabajo en ${quote(loop.gateway.name || "la compuerta")}`,
      evidence:
        `El ${pctOf(loop.share)} de las veces el caso vuelve atrás (${branchLabel(graph, loop.flowId)}). ` +
        `Para ${result.started} solicitudes se ejecutan ${repeated || "pasos repetidos"}.`,
      elementIds: [loop.gateway.id, ...loop.taskIds],
    });
  }
  if (loops[0]) {
    const { gateway, flowId } = loops[0];
    const gName = gateway.name || "la compuerta";
    plans.push({
      kind: "eliminar-retrabajo",
      title: `Eliminar el retrabajo en ${quote(gName)}`,
      how:
        "Validar la información en origen —formulario con campos obligatorios, lista de " +
        "documentos o validación automática— para que ningún caso tenga que volver atrás.",
      diagram: `Quitar la rama ${quote(branchLabel(graph, flowId))} de ${quote(gName)}: la validación pasa al inicio.`,
      elementIds: [gateway.id],
      redesign: true,
      patch: (c) => ({
        ...c,
        gateways: { ...c.gateways, [gateway.id]: { ...(c.gateways[gateway.id] ?? {}), [flowId]: 0 } },
      }),
    });
  }

  // 5. Recursos saturados y colas
  const saturated = result.resources
    .filter((r) => r.utilization >= SATURATION)
    .sort((a, b) => b.utilization - a.utilization);
  for (const r of saturated) {
    const staff = r.variableCapacity
      ? `hasta ${r.capacity} ${r.capacity === 1 ? "persona" : "personas"} por turno`
      : `${r.capacity} ${r.capacity === 1 ? "persona" : "personas"}`;
    findings.push({
      kind: "saturacion",
      severity: r.utilization >= 0.95 ? "alta" : "media",
      title: `${quote(r.name)} está saturado`,
      evidence: `Trabaja al ${pctOf(r.utilization)} de su capacidad (${staff}): cualquier pico de demanda se convierte en cola.`,
      elementIds: [],
    });
  }

  const queued = result.activities
    .filter((a) => graph.nodes.get(a.id)?.kind === "task" && config.tasks[a.id]?.resource && a.visits > 0)
    .map((a) => ({ a, avgWait: a.totalWaiting / a.visits, resource: config.tasks[a.id]!.resource! }))
    .sort((x, y) => y.avgWait - x.avgWait);
  const worstQueue = queued[0];
  const hasQueue = Boolean(worstQueue && kpis.cycle > 0 && worstQueue.avgWait / kpis.cycle >= QUEUE_SHARE);
  if (worstQueue && hasQueue) {
    findings.push({
      kind: "cola",
      severity: worstQueue.avgWait / kpis.cycle >= 0.25 ? "alta" : "media",
      title: `Cuello de botella en ${quote(worstQueue.a.name)}`,
      evidence:
        `Cada caso espera ${fmtDuration(worstQueue.avgWait)} en cola a que ${quote(worstQueue.resource)} ` +
        `quede libre (${worstQueue.a.visits} ejecuciones).`,
      elementIds: [worstQueue.a.id],
    });
  }

  if (saturated[0]) {
    const name = saturated[0].name;
    const capacity = saturated[0].capacity;
    const byShifts = Boolean(config.resources[name]?.shifts?.length);
    plans.push({
      kind: "ampliar-capacidad",
      title: byShifts
        ? `Reforzar ${quote(name)} con una persona más por turno`
        : `Reforzar ${quote(name)} con una persona más`,
      how:
        (byShifts ? "Sumar una persona a cada turno." : `Pasar de ${capacity} a ${capacity + 1}.`) +
        " Antes de contratar, conviene sacar de su cola el trabajo que puede hacer un sistema.",
      diagram: byShifts
        ? `Dotación de ${quote(name)}: +1 persona en cada turno.`
        : `Capacidad de ${quote(name)}: ${capacity} → ${capacity + 1}.`,
      elementIds: [],
      extraCost: extraCapacityCost(config, result, name),
      redesign: false,
      patch: (c) => {
        const def = c.resources[name];
        const reinforced = def.shifts?.length
          ? { ...def, shifts: def.shifts.map((s) => ({ ...s, capacity: s.capacity + 1 })) }
          : { ...def, capacity: capacity + 1 };
        return { ...c, resources: { ...c.resources, [name]: reinforced } };
      },
    });
  }

  // 6. Trabajo manual automatizable. Solo se propone si el proceso sufre
  //    (esperas, colas o saturación): sin dolor, automatizar no es prioritario.
  const teamMinutes = result.resources.reduce((s, r) => s + r.busyTime, 0);
  const manual = result.activities
    .filter((a) => {
      const n = graph.nodes.get(a.id);
      return n?.kind === "task" && !AUTOMATED_TYPES.has(n.bpmnType) && Boolean(config.tasks[a.id]?.resource) && a.totalProcessing > 0;
    })
    .sort((x, y) => y.totalProcessing - x.totalProcessing);
  const topManual = manual[0];
  const pain = lowEfficiency || hasQueue || saturated.length > 0;
  if (topManual && teamMinutes > 0 && pain) {
    const share = topManual.totalProcessing / teamMinutes;
    if (share >= MANUAL_SHARE) {
      findings.push({
        kind: "manual",
        severity: share >= 0.35 ? "alta" : "media",
        title: `${quote(topManual.name)} consume el ${pctOf(share)} del tiempo del equipo`,
        evidence:
          `${fmtDuration(topManual.totalProcessing / topManual.visits)} por ejecución y ` +
          `${(topManual.totalProcessing / 60).toFixed(0)} h en total. Si sigue reglas claras, es candidata a automatizar.`,
        elementIds: [topManual.id],
      });
      plans.push({
        kind: "automatizar",
        title: `Automatizar ${quote(topManual.name)}`,
        how:
          "Convertirla en una tarea de sistema (reglas de negocio, scoring o integración) y " +
          "dejar a las personas solo las excepciones.",
        diagram: `${quote(topManual.name)} pasa a ser una tarea de servicio, sin recurso humano.`,
        elementIds: [topManual.id],
        redesign: true,
        patch: (c) => ({
          ...c,
          tasks: {
            ...c.tasks,
            [topManual.id]: {
              ...(c.tasks[topManual.id] ?? {}),
              duration: { kind: "fixed", mean: AUTOMATED_TASK_MIN },
              resource: undefined,
            },
          },
        }),
      });
    }
  }

  // 7. Concentración del costo (con dos actividades es trivial: no se señala)
  const costed = result.activities.filter((a) => a.cost > 0);
  if (kpis.totalCost > 0 && costed.length >= 3) {
    const top = [...costed].sort((a, b) => b.cost - a.cost)[0];
    const share = top.cost / kpis.totalCost;
    if (share >= COST_CONCENTRATION) {
      findings.push({
        kind: "costo",
        severity: "media",
        title: `${quote(top.name)} concentra el ${pctOf(share)} del costo`,
        evidence: `${money(top.cost, currency)} de ${money(kpis.totalCost, currency)} en total.`,
        elementIds: [top.id],
      });
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // ── "¿Y si…?": cada palanca se mide re-simulando ─────────────────────────
  const realInstances = Math.max(1, Math.floor(Number(config.instances)) || 1);
  const whatIfInstances = Math.min(realInstances, WHAT_IF_MAX_INSTANCES);
  const run = (c: SimConfig) => kpisOf(runSimulation(graph, { ...c, instances: whatIfInstances }));
  const baseline = whatIfInstances === realInstances ? kpis : run(config);

  const levers: Lever[] = plans
    .map(({ patch, redesign: _redesign, ...lever }) => ({ ...lever, after: run(patch(config)) }))
    .sort((a, b) => a.after.cycle - b.after.cycle);

  const redesign = plans.filter((p) => p.redesign);
  const combined = redesign.length ? run(redesign.reduce((c, p) => p.patch(c), config)) : null;

  return {
    processName: input.processName?.trim() || "Proceso",
    scenarioLabel: input.scenarioLabel ?? "",
    currency,
    kpis,
    baseline,
    findings,
    levers,
    combined,
    whatIfInstances,
  };
}

// ── Informe del AS-IS ────────────────────────────────────────────────────────

const MUDA: Partial<Record<FindingKind, string>> = {
  eficiencia: "Espera",
  espera: "Espera",
  horario: "Espera por horario",
  retrabajo: "Retrabajo (defectos)",
  manual: "Sobreprocesamiento manual",
  costo: "Sobrecosto",
};

function impactLine(title: string, before: Kpis, after: Kpis, currency: string): string {
  return (
    `- **${title}**: cycle time ${fmtDuration(before.cycle)} → ${fmtDuration(after.cycle)} ` +
    `(${change(before.cycle, after.cycle)}) · espera ${change(before.waiting, after.waiting)} · ` +
    `costo por solicitud ${money(after.costPerCase, currency)} (${change(before.costPerCase, after.costPerCase)})`
  );
}

export function renderDiagnosis(a: ScenarioAnalysis): string {
  const k = a.kpis;
  const L: string[] = [];

  L.push("### 1. Diagnóstico");
  L.push(`- Cycle time medio **${fmtDuration(k.cycle)}** de reloj (**${fmtDuration(k.cycleExcl)}** en tiempo hábil).`);
  L.push(
    `- Por solicitud: **${fmtDuration(k.processing)}** de trabajo, **${fmtDuration(k.waiting)}** de espera` +
    (k.idle > 0 ? ` y **${fmtDuration(k.idle)}** parada fuera de horario` : "") +
    ` → eficiencia **${pctOf(k.efficiency)}**.` +
    (k.cycle > 0 && k.efficiency < LOW_EFFICIENCY ? " El problema no es cuánto tarda el trabajo, sino cuánto espera." : ""),
  );
  L.push(
    `- Completadas **${k.completed}/${k.started}** · throughput **${k.throughputPerHour.toFixed(2)}/h** · ` +
    `costo **${money(k.totalCost, a.currency)}** (${money(k.costPerCase, a.currency)} por solicitud).`,
  );
  if (k.completed < k.started) {
    L.push(`- ${k.started - k.completed} solicitudes no llegaron al final dentro del horizonte simulado.`);
  }

  L.push("", "### 2. Cuellos de botella");
  const bottlenecks = a.findings.filter((f) => f.kind === "saturacion" || f.kind === "cola");
  if (bottlenecks.length) for (const f of bottlenecks) L.push(`- **${f.title}.** ${f.evidence}`);
  else L.push("- Ningún recurso supera el 85 % de utilización ni acumula colas relevantes.");

  L.push("", "### 3. Desperdicios (mudas)");
  const wastes = a.findings.filter((f) => MUDA[f.kind]);
  if (wastes.length) for (const f of wastes) L.push(`- **${MUDA[f.kind]}** — ${f.title}. ${f.evidence}`);
  else L.push("- No aparecen desperdicios relevantes con estos datos.");

  L.push("", "### 4. Qué mejorar y cómo");
  if (a.levers.length) a.levers.forEach((l, i) => L.push(`${i + 1}. **${l.title}** — ${l.how}`));
  else L.push("- Con estos datos no hay una palanca clara. Prueba con más instancias o revisa duraciones, recursos y probabilidades.");

  L.push("", "### 5. Diseño del TO-BE propuesto");
  const redesign = a.levers.filter((l) => l.kind !== "ampliar-capacidad");
  const hire = a.levers.find((l) => l.kind === "ampliar-capacidad");
  if (redesign.length) for (const l of redesign) L.push(`- ${l.diagram}`);
  else L.push("- El flujo actual no muestra cambios de diseño evidentes.");
  if (hire) L.push(`- Solo si la cola persiste tras el rediseño: ${hire.diagram}`);

  L.push("", "### 6. Impacto esperado");
  if (a.levers.length) {
    for (const l of a.levers) L.push(impactLine(l.title, a.baseline, l.after, a.currency));
    if (a.combined) L.push(impactLine("TO-BE: rediseño con el mismo equipo", a.baseline, a.combined, a.currency));
    L.push(
      "",
      `> Cifras obtenidas re-simulando ${a.whatIfInstances} solicitudes de este mismo escenario con cada ` +
      "cambio aplicado (misma semilla y mismas llegadas).",
    );
    if (hire?.extraCost) {
      L.push(`> La dotación extra no está en el costo simulado: añade ≈ ${money(hire.extraCost, a.currency)} en el periodo.`);
    }
  } else {
    L.push("- Sin cambios propuestos no hay impacto que estimar.");
  }

  return L.join("\n");
}

// ── Metodología ──────────────────────────────────────────────────────────────

export function renderMethodology(a: ScenarioAnalysis): string {
  const has = (...kinds: FindingKind[]) => a.findings.some((f) => kinds.includes(f.kind));
  const items: Array<[string, string]> = [];
  if (has("espera", "eficiencia", "horario")) {
    items.push([
      "Lean (mapa de flujo de valor)",
      `la eficiencia es del ${pctOf(a.kpis.efficiency)}: casi todo el cycle time es espera, y eso es lo que Lean elimina.`,
    ]);
  }
  if (has("retrabajo")) {
    items.push(["Six Sigma (DMAIC)", "hay retrabajo recurrente: medir la causa raíz del defecto y ponerle un control en origen."]);
  }
  if (has("saturacion", "cola")) {
    items.push(["Teoría de Restricciones", "un recurso marca el ritmo: explotarlo al máximo, subordinar el resto a él y solo después ampliarlo."]);
  }
  if (has("manual")) {
    items.push(["Automatización (BPM / RPA)", "una tarea manual concentra el tiempo del equipo."]);
  }
  if (!items.length) {
    items.push(["Mejora continua (PDCA)", "no hay un problema dominante: ajustar, medir y repetir."]);
  }

  const L = ["### Metodología recomendada", ...items.map(([m, why], i) => `${i + 1}. **${m}** — ${why}`)];
  if (a.levers.length) {
    L.push("", "### Próximos pasos");
    for (const l of a.levers.slice(0, 3)) L.push(`- ${l.title}: ${l.how}`);
  }
  return L.join("\n");
}

// ── Guía para rellenar los datos ─────────────────────────────────────────────

export function renderDataGuide(graph: SimGraph): string {
  const nodes = [...graph.nodes.values()];
  const tasks = nodes.filter((n) => n.kind === "task");
  const gateways = nodes.filter((n) => (n.kind === "xor" || n.kind === "or") && n.outgoing.length > 1);
  const events = nodes.filter((n) => n.kind === "event");
  const label = (n: SimNode) => quote(n.name || n.bpmnType.replace("bpmn:", ""));

  const L: string[] = [
    "### Escenario",
    "- **Nº de instancias**: cuántas solicitudes simular. Con 100–500 los promedios ya son estables.",
    "- **Tiempo entre llegadas**: cada cuánto entra una solicitud, contado dentro del horario de llegadas. Si llegan 8 al día en una jornada de 8 h, la media es 60 min (exponencial).",
    "- **Horario de llegadas**: las solicitudes solo se crean dentro de él. Usa 24/7 si también llegan de noche.",
    "- **Inicio del escenario**: fecha desde la que se aplican los horarios.",
    "",
    "### Recursos",
    "- Quién hace el trabajo: **personas**, **costo por hora** y **horario**.",
    "- Si trabajan por **turnos** (24/7, turno de noche o distinta dotación en cada turno), elige «Turnos» y define cada turno con su hora de entrada, salida y personas.",
    "- Las tareas con recurso solo avanzan con alguien en turno y forman cola si no hay nadie libre.",
  ];

  if (tasks.length) {
    L.push("", "### Tareas");
    for (const t of tasks) {
      L.push(
        AUTOMATED_TYPES.has(t.bpmnType)
          ? `- ${label(t)}: tarea de sistema → duración **fija** de 1–2 min y sin recurso.`
          : `- ${label(t)}: duración **normal** con la media que estime quien la hace (y su desviación), y el **recurso** que la ejecuta.`,
      );
    }
  }
  if (gateways.length) {
    L.push("", "### Compuertas");
    for (const g of gateways) {
      L.push(`- ${label(g)}: probabilidad de cada rama (${g.outgoing.map((f) => branchLabel(graph, f)).join(" / ")}). Deben sumar 1.`);
    }
  }
  if (events.length) {
    L.push("", "### Eventos de espera");
    for (const e of events) L.push(`- ${label(e)}: **demora** (p. ej. fija de 3 días si depende de una sesión semanal).`);
  }
  return L.join("\n");
}

// ── Veredicto AS-IS vs TO-BE ─────────────────────────────────────────────────

export function compareScenarios(asis: ScenarioData, tobe: ScenarioData): Comparison {
  const cur = asis.currency || tobe.currency || "$";
  const perCase = (d: ScenarioData) => (d.completed ? d.totalCost / d.completed : 0);
  const maxUtil = (d: ScenarioData) => d.resources.reduce((m, r) => Math.max(m, r.utilization), 0);
  const rate = (d: ScenarioData) => (d.started ? d.completed / d.started : 0);
  const idle = (d: ScenarioData) => d.avgIdle ?? 0;

  const cycleChange = ratio(asis.avgCycle, tobe.avgCycle);
  const waitChange = ratio(asis.avgWaiting, tobe.avgWaiting);
  const costPerCaseChange = ratio(perCase(asis), perCase(tobe));
  const throughputChange = ratio(asis.throughputPerHour, tobe.throughputPerHour);

  const rows: Comparison["rows"] = [
    ["Cycle time", fmtDuration(asis.avgCycle), fmtDuration(tobe.avgCycle), change(asis.avgCycle, tobe.avgCycle)],
    ["Cycle hábil", fmtDuration(asis.avgCycleExcl), fmtDuration(tobe.avgCycleExcl), change(asis.avgCycleExcl, tobe.avgCycleExcl)],
    ["Trabajo", fmtDuration(asis.avgProcessing), fmtDuration(tobe.avgProcessing), change(asis.avgProcessing, tobe.avgProcessing)],
    ["Espera", fmtDuration(asis.avgWaiting), fmtDuration(tobe.avgWaiting), change(asis.avgWaiting, tobe.avgWaiting)],
    ["Fuera de horario", fmtDuration(idle(asis)), fmtDuration(idle(tobe)), change(idle(asis), idle(tobe))],
    ["Eficiencia", pctOf(asis.cycleEfficiency), pctOf(tobe.cycleEfficiency), points(asis.cycleEfficiency, tobe.cycleEfficiency)],
    ["Costo/solicitud", money(perCase(asis), cur), money(perCase(tobe), cur), change(perCase(asis), perCase(tobe))],
    ["Costo total", money(asis.totalCost, cur), money(tobe.totalCost, cur), change(asis.totalCost, tobe.totalCost)],
    ["Throughput", `${asis.throughputPerHour.toFixed(2)}/h`, `${tobe.throughputPerHour.toFixed(2)}/h`, change(asis.throughputPerHour, tobe.throughputPerHour)],
    ["Utiliz. máx.", pctOf(maxUtil(asis)), pctOf(maxUtil(tobe)), points(maxUtil(asis), maxUtil(tobe))],
    ["Completadas", `${asis.completed}/${asis.started}`, `${tobe.completed}/${tobe.started}`, change(rate(asis), rate(tobe))],
  ];

  const risks: string[] = [];
  for (const r of tobe.resources) {
    if (r.utilization >= 0.9) risks.push(`${quote(r.name)} queda al ${pctOf(r.utilization)}: sin margen ante picos de demanda.`);
  }
  if (rate(tobe) < rate(asis) - 0.02) {
    risks.push(`Terminan menos solicitudes: ${tobe.completed}/${tobe.started} frente a ${asis.completed}/${asis.started}.`);
  }
  if (throughputChange <= -WORSE) risks.push(`El throughput cae un ${pctOf(-throughputChange)}.`);
  if (cycleChange >= WORSE) risks.push(`El cycle time empeora un ${pctOf(cycleChange)}.`);
  if (costPerCaseChange >= WORSE) risks.push(`El costo por solicitud sube un ${pctOf(costPerCaseChange)}.`);

  const improves = cycleChange <= -BETTER || costPerCaseChange <= -BETTER;
  const worsens = cycleChange >= WORSE || costPerCaseChange >= WORSE;
  let decision: Decision;
  if (!improves || (cycleChange >= WORSE && costPerCaseChange >= WORSE)) decision = "no-implementar";
  else if (!worsens && risks.length === 0) decision = "implementar";
  else decision = "implementar-con-ajustes";

  return { asis, tobe, rows, cycleChange, waitChange, costPerCaseChange, decision, risks };
}

/** ¿Es la misma actividad? Tolera renombrados que amplían el nombre original
 *  ("Formalizar y desembolsar" → "Formalizar y desembolsar en línea"). */
function sameActivity(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 8 && (x.startsWith(y) || y.startsWith(x));
}

export function renderVerdict(c: Comparison): string {
  const { asis, tobe } = c;
  const cur = asis.currency || tobe.currency || "$";
  const L: string[] = [];

  L.push("### 1. Comparación cuantitativa");
  L.push("| Indicador | AS-IS | TO-BE | Cambio |", "|---|---|---|---|");
  for (const [k, a, t, d] of c.rows) L.push(`| ${k} | ${a} | ${t} | ${d} |`);

  L.push("", "### 2. Qué mejoró y por qué");
  // Tiempo parado = cola + fuera de horario: las dos se atacan con el rediseño.
  const stoppedAsis = asis.avgWaiting + (asis.avgIdle ?? 0);
  const stoppedTobe = tobe.avgWaiting + (tobe.avgIdle ?? 0);
  const stoppedCut = stoppedAsis - stoppedTobe;
  const workCut = asis.avgProcessing - tobe.avgProcessing;
  if (stoppedCut > 0 || workCut > 0) {
    L.push(
      stoppedCut >= workCut
        ? `- La mejora viene sobre todo del **tiempo parado** (cola y fuera de horario): ${fmtDuration(stoppedAsis)} → ${fmtDuration(stoppedTobe)} por solicitud (${change(stoppedAsis, stoppedTobe)}).`
        : `- La mejora viene sobre todo del **trabajo**: ${fmtDuration(asis.avgProcessing)} → ${fmtDuration(tobe.avgProcessing)} por solicitud (${change(asis.avgProcessing, tobe.avgProcessing)}).`,
    );
  } else {
    L.push("- Ni el tiempo parado ni el tiempo de trabajo bajan.");
  }
  // Las que más pesaban primero: costo y, a igualdad, espera.
  const removed = asis.activities
    .filter((x) => !tobe.activities.some((t) => sameActivity(x.name, t.name)))
    .sort((a, b) => b.cost - a.cost || b.wait - a.wait);
  const added = tobe.activities.filter((x) => !asis.activities.some((a) => sameActivity(a.name, x.name)));
  if (removed.length) {
    const items = removed.map((x) =>
      `${quote(x.name)} (${money(x.cost, cur)}${x.wait > 0 ? `, ${fmtDuration(x.wait)} de espera por paso` : ""})`);
    L.push(`- Ya no están en el TO-BE: ${listOf(items, 4)}.`);
  }
  if (added.length) L.push(`- Nuevas en el TO-BE: ${listOf(added.map((x) => quote(x.name)), 4)}.`);
  if (c.costPerCaseChange <= -BETTER) {
    L.push(`- El costo por solicitud baja un ${pctOf(-c.costPerCaseChange)}.`);
  }

  L.push("", "### 3. Riesgos y trade-offs");
  for (const r of c.risks) L.push(`- ${r}`);
  L.push(
    "- Las tareas automáticas se simulan con la duración indicada: si la integración real tarda más o falla, " +
    "el beneficio se reduce. Conviene validarlo con un piloto.",
  );

  L.push("", "### 4. VEREDICTO FINAL");
  const cycle = `el cycle time ${c.cycleChange <= 0 ? "baja" : "sube"} un ${pctOf(Math.abs(c.cycleChange))}`;
  const cost = `el costo por solicitud ${c.costPerCaseChange <= 0 ? "baja" : "sube"} un ${pctOf(Math.abs(c.costPerCaseChange))}`;
  if (c.decision === "implementar") {
    L.push(`**Se implementa el TO-BE.** ${cap(cycle)} y ${cost}, sin que empeore ningún indicador.`);
  } else if (c.decision === "implementar-con-ajustes") {
    L.push(`**Se implementa con ajustes.** ${cap(cycle)} y ${cost}, pero antes hay que resolver: ${c.risks.join(" ")}`);
  } else {
    L.push(`**No se implementa tal como está.** ${cap(cycle)} y ${cost}: no hay una mejora suficiente que lo justifique.`);
  }
  return L.join("\n");
}
