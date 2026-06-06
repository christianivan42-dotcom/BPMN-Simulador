import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Play, Pause, RotateCcw, X, Gauge, Activity, Boxes, GitBranch, Zap, Clock, MousePointerClick, ShieldAlert, Timer, Mail, AlertTriangle, ChevronUp, CalendarDays, Coins, Brain, Sparkles, Lightbulb, Wand2, GitCompare, Loader2, FileSpreadsheet } from "lucide-react";
import { buildSimGraph, type SimGraph, type SimNode, type EventTrigger } from "../../bpmn/sim/simGraph";
import { runSimulation, type SimConfig, type SimResult } from "../../bpmn/sim/simEngine";
import { TokenAnimator, type AnimatorTick } from "../../bpmn/sim/tokenAnimator";
import { DISTRIBUTION_LABELS, DISTRIBUTION_PARAMS, PARAM_LABELS, type DistributionKind, type Distribution, type DistParam } from "../../bpmn/sim/distributions";
import { TIME_UNIT_LABELS, UNIT_TO_MIN, type TimeUnit } from "../../bpmn/sim/units";
import { defaultTimetables, type Timetable } from "../../bpmn/sim/calendar";
import { expertAsk } from "../../api";
import { ChatMarkdown } from "../ChatMarkdown";
import { downloadXls, cell, hdr, title, sub, type XlsSheet } from "../../bpmn/sim/simExport";

interface Modeler { get: (name: string) => unknown; }

// ── Exportación a Excel ──────────────────────────────────────────────────────
interface SimExportData {
  scenarioLabel: string; name: string; currency: string;
  completed: number; started: number;
  avgCycle: number; minCycle: number; maxCycle: number; avgCycleExcl: number;
  avgProcessing: number; avgWaiting: number; avgTransfer: number;
  cycleEfficiency: number; throughputPerHour: number; totalCost: number;
  activities: Array<{ name: string; visits: number; proc: number; wait: number; cost: number; durOver: number; costOver: number }>;
  resources: Array<{ name: string; capacity: number; utilization: number; cost: number }>;
}
const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
const exportKey = (scenario: string | undefined, companyId: string | undefined) => `bpms_sim_data_${scenario ?? "x"}_${companyId ?? "x"}`;

function kpiRows(d: SimExportData): Array<[string, number, string]> {
  return [
    ["Instancias completadas", d.completed, `de ${d.started}`],
    ["Cycle time medio (reloj)", r2(d.avgCycle), "min"],
    ["Cycle time mínimo", r2(d.minCycle), "min"],
    ["Cycle time máximo", r2(d.maxCycle), "min"],
    ["Cycle time hábil (sin off-horario)", r2(d.avgCycleExcl), "min"],
    ["Tiempo de proceso medio", r2(d.avgProcessing), "min"],
    ["Tiempo de espera medio", r2(d.avgWaiting), "min"],
    ["Traslado medio", r2(d.avgTransfer), "min"],
    ["Eficiencia (proc/cycle)", r2(d.cycleEfficiency * 100), "%"],
    ["Throughput", r2(d.throughputPerHour), "/h"],
    ["Costo total", r2(d.totalCost), d.currency],
  ];
}

function stackedSheet(name: string, d: SimExportData): XlsSheet {
  const rows = [
    [title(`Simulación — ${d.name}`)],
    [sub(`Escenario: ${d.scenarioLabel}`)],
    [],
    [sub("Indicadores")],
    [hdr("Indicador"), hdr("Valor"), hdr("Unidad")],
    ...kpiRows(d).map(([k, v, u]) => [cell(k), cell(v), cell(u)]),
    [],
    [sub("Por actividad")],
    [hdr("Actividad"), hdr("Visitas"), hdr("Proc. medio (min)"), hdr("Espera media (min)"), hdr(`Costo (${d.currency})`), hdr("Excede duración"), hdr("Excede costo")],
    ...d.activities.map((a) => [cell(a.name), cell(a.visits), cell(r2(a.proc)), cell(r2(a.wait)), cell(r2(a.cost)), cell(a.durOver), cell(a.costOver)]),
    [],
    [sub("Recursos")],
    [hdr("Recurso"), hdr("Capacidad"), hdr("Utilización %"), hdr(`Costo (${d.currency})`)],
    ...d.resources.map((rs) => [cell(rs.name), cell(rs.capacity), cell(r2(rs.utilization * 100)), cell(r2(rs.cost))]),
  ];
  return { name, rows };
}

function comparisonSheet(asis: SimExportData, tobe: SimExportData): XlsSheet {
  const ka = kpiRows(asis), kt = kpiRows(tobe);
  const rows = [
    [title("Comparación AS-IS vs TO-BE")],
    [],
    [hdr("Indicador"), hdr("AS-IS"), hdr("TO-BE"), hdr("Δ (TO-BE − AS-IS)"), hdr("Unidad")],
    ...ka.map(([label, av, unit], i) => {
      const tv = kt[i]?.[1] ?? 0;
      return [cell(label), cell(av), cell(tv), cell(r2(tv - av)), cell(unit)];
    }),
  ];
  return { name: "Comparación", rows };
}

const AI_ROLE =
  "Eres un consultor experto en simulación cuantitativa de procesos de negocio " +
  "y en mejora de procesos: Lean (7 mudas, VSM), Six Sigma (DMAIC), Teoría de Restricciones (TOC), BPR/rediseño y automatización (RPA). " +
  "Tu audiencia son analistas que NO dominan los parámetros de simulación: explica con claridad, en español, sé concreto y accionable.";

const summaryKey = (scenario: string | undefined, companyId: string | undefined) =>
  `bpms_sim_summary_${scenario ?? "x"}_${companyId ?? "x"}`;

// ── Entrada de distribución (con parámetros + unidad) ─────────────────────────
interface DistInput {
  kind: DistributionKind;
  mean: number; std: number; min: number; max: number; mode: number;
  unit: TimeUnit;
}
function newDist(mean = 10, unit: TimeUnit = "minutes", kind: DistributionKind = "exponential"): DistInput {
  return { kind, mean, std: Math.round(mean * 0.25 * 100) / 100, min: Math.round(mean * 0.5 * 100) / 100, max: Math.round(mean * 1.5 * 100) / 100, mode: mean, unit };
}
function toDistribution(d: DistInput): Distribution {
  const u = UNIT_TO_MIN[d.unit];
  return { kind: d.kind, mean: d.mean * u, std: d.std * u, min: d.min * u, max: d.max * u, mode: d.mode * u };
}
function distSummary(d: DistInput): string {
  const u = TIME_UNIT_LABELS[d.unit].toLowerCase().slice(0, 3);
  const lbl = DISTRIBUTION_LABELS[d.kind].split(" ")[0].toLowerCase();
  if (d.kind === "uniform") return `${lbl} ${d.min}–${d.max} ${u}`;
  if (d.kind === "triangular") return `${lbl} ${d.min}/${d.mode}/${d.max} ${u}`;
  return `${lbl} ${d.mean} ${u}`;
}

interface TaskCfg {
  dur: DistInput; resource: string;
  fixedCost: number; costThreshold: number; durThreshold: number; durThresholdUnit: TimeUnit;
}
interface ResourceRow { name: string; capacity: number; costPerHour: number; timetableId: string; }

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const CURRENCIES = ["$", "USD", "EUR", "MXN", "COP", "PEN", "CLP", "ARS"];

function fmtTime(min: number): string {
  if (min < 60) return `${min.toFixed(1)} min`;
  if (min < 1440) { const h = Math.floor(min / 60); const m = Math.round(min % 60); return `${h}h ${m}m`; }
  const d = Math.floor(min / 1440); const h = Math.round((min % 1440) / 60); return `${d}d ${h}h`;
}
function minToHHMM(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function defaultStartDate(): string {
  const d = new Date(); d.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const TRIGGER_LABEL: Record<EventTrigger, string> = {
  none: "Simple", timer: "Temporizador (plazo)", message: "Mensaje", error: "Error",
  escalation: "Escalación", signal: "Señal", conditional: "Condición",
};
function TriggerIcon({ t, size = 13 }: { t?: EventTrigger; size?: number }) {
  switch (t) {
    case "timer": return <Timer size={size} />;
    case "message": return <Mail size={size} />;
    case "error": return <AlertTriangle size={size} />;
    case "escalation": return <ShieldAlert size={size} />;
    default: return <ShieldAlert size={size} />;
  }
}

// ── Editor de distribución reutilizable (kind + parámetros + unidad) ──────────
function DistributionEditor({ value, onChange }: { value: DistInput; onChange: (d: DistInput) => void }) {
  const params = DISTRIBUTION_PARAMS[value.kind];
  return (
    <div className="sim-dist">
      <select value={value.kind} title="distribución" onChange={(e) => onChange({ ...value, kind: e.target.value as DistributionKind })}>
        {Object.entries(DISTRIBUTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <div className="sim-dist-params">
        {params.map((p: DistParam) => (
          <label key={p} className="sim-dist-param">
            <span>{PARAM_LABELS[p]}</span>
            <input type="number" min={0} step="any" value={value[p]}
              onChange={(e) => onChange({ ...value, [p]: Number(e.target.value) })} />
          </label>
        ))}
        <label className="sim-dist-param">
          <span>Unidad</span>
          <select value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as TimeUnit })}>
            {Object.entries(TIME_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

export function SimulationPanel({ modeler, onClose, scenario, processId, processName }: { modeler: Modeler; onClose: () => void; scenario?: "asis" | "tobe"; processId?: string; processName?: string }) {
  const graph = useMemo<SimGraph>(() => buildSimGraph(modeler.get("elementRegistry") as never), [modeler]);
  const scenarioLabel = scenario === "tobe" ? "TO-BE (propuesto)" : scenario === "asis" ? "AS-IS (actual)" : "el proceso";

  const taskNodes = useMemo(() => [...graph.nodes.values()].filter((n) => n.kind === "task"), [graph]);
  const gatewayNodes = useMemo(() => [...graph.nodes.values()].filter((n) => (n.kind === "xor" || n.kind === "or") && n.outgoing.length > 1), [graph]);
  const eventNodes = useMemo(() => [...graph.nodes.values()].filter((n) => n.kind === "event"), [graph]);
  const boundaryNodes = useMemo(() => [...graph.nodes.values()].filter((n) => n.kind === "boundary"), [graph]);

  // ── escenario global ───────────────────────────────────────────────────────
  const [instances, setInstances] = useState(50);
  const [arrival, setArrival] = useState<DistInput>(() => newDist(10, "minutes", "exponential"));
  const [transferTime, setTransferTime] = useState(0.5);
  const [speed, setSpeed] = useState(40);
  const [defaultMean, setDefaultMean] = useState(15);
  const [warmup, setWarmup] = useState(0);
  const [currency, setCurrency] = useState("$");
  const [startDate, setStartDate] = useState(defaultStartDate);

  // ── por elemento ────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<Record<string, TaskCfg>>({});
  const [weights, setWeights] = useState<Record<string, Record<string, number>>>({});
  const [delays, setDelays] = useState<Record<string, DistInput>>({});
  const [boundaries, setBoundaries] = useState<Record<string, DistInput>>({});
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [timetables, setTimetables] = useState<Timetable[]>(() => defaultTimetables());

  useEffect(() => {
    const t: Record<string, TaskCfg> = {};
    for (const n of taskNodes) t[n.id] = { dur: newDist(defaultMean, "minutes", "exponential"), resource: "", fixedCost: 0, costThreshold: 0, durThreshold: 0, durThresholdUnit: "minutes" };
    setTasks(t);
    const w: Record<string, Record<string, number>> = {};
    for (const g of gatewayNodes) {
      w[g.id] = {};
      const eq = Math.round((1 / g.outgoing.length) * 100) / 100;
      for (const f of g.outgoing) {
        const nm = (graph.flows.get(f)?.name ?? "").trim();
        const num = /^\d*\.?\d+$/.test(nm) ? Number(nm) : NaN;
        w[g.id][f] = Number.isFinite(num) ? num : eq;
      }
    }
    setWeights(w);
    const dl: Record<string, DistInput> = {};
    for (const e of eventNodes) {
      const s = (e.name || "").toLowerCase();
      let def = 0; let unit: TimeUnit = "minutes";
      if (s.includes("día") || s.includes("dias") || s.includes("proclama")) { def = 5; unit = "days"; }
      else if (s.includes("notario")) { def = 1; unit = "days"; }
      dl[e.id] = newDist(def, unit, "fixed");
    }
    setDelays(dl);
    const b: Record<string, DistInput> = {};
    for (const e of boundaryNodes) b[e.id] = newDist(0, "minutes", "fixed");
    setBoundaries(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // ── animador + resultado ──────────────────────────────────────────────────
  const animatorRef = useRef<TokenAnimator | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [tick, setTick] = useState<AnimatorTick>({ time: 0, liveTokens: 0, progress: 0, playing: false });
  const [hasRun, setHasRun] = useState(false);
  const [section, setSection] = useState<"config" | "results" | "ia">("config");

  // ── Asistente IA ────────────────────────────────────────────────────────────
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTitle, setAiTitle] = useState<string | null>(null);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const anim = new TokenAnimator(modeler, graph);
    anim.onTick(setTick);
    animatorRef.current = anim;
    return () => { anim.destroy(); animatorRef.current = null; };
  }, [modeler, graph]);

  useEffect(() => { animatorRef.current?.setSpeed(speed); }, [speed]);

  // ── selección por clic en el canvas ────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  useEffect(() => {
    const eventBus = modeler.get("eventBus") as { on: (e: string, f: (ev: { element?: { id: string } }) => void) => void; off?: (e: string, f: unknown) => void };
    const canvas = modeler.get("canvas") as { addMarker: (id: string, c: string) => void; removeMarker: (id: string, c: string) => void };
    const handler = (ev: { element?: { id: string } }) => {
      const id = ev.element?.id;
      const prev = selectedRef.current;
      if (prev) { try { canvas.removeMarker(prev, "sim-selected"); } catch { /* ok */ } }
      if (id && graph.nodes.has(id) && ["task", "xor", "or", "event", "boundary"].includes(graph.nodes.get(id)!.kind)) {
        setSelectedId(id); setSection("config");
        try { canvas.addMarker(id, "sim-selected"); } catch { /* ok */ }
      } else setSelectedId(null);
    };
    eventBus.on("element.click", handler);
    return () => {
      const prev = selectedRef.current;
      if (prev) { try { canvas.removeMarker(prev, "sim-selected"); } catch { /* ok */ } }
      eventBus.off?.("element.click", handler);
    };
  }, [modeler, graph]);

  function flowLabel(flowId: string): string {
    const f = graph.flows.get(flowId);
    if (!f) return flowId;
    const tgt = graph.nodes.get(f.target);
    return f.name || `→ ${tgt?.name || tgt?.bpmnType.replace("bpmn:", "") || flowId}`;
  }

  function run() {
    if (graph.starts.length === 0) { alert("El diagrama no tiene evento de inicio (Start Event). Añade uno para simular."); return; }
    const cfgTasks: SimConfig["tasks"] = {};
    for (const [id, c] of Object.entries(tasks)) {
      cfgTasks[id] = {
        duration: toDistribution(c.dur),
        resource: c.resource || undefined,
        fixedCost: c.fixedCost || undefined,
        costThreshold: c.costThreshold || undefined,
        durationThreshold: c.durThreshold ? c.durThreshold * UNIT_TO_MIN[c.durThresholdUnit] : undefined,
      };
    }
    const cfgRes: SimConfig["resources"] = {};
    for (const r of resources) if (r.name.trim()) cfgRes[r.name.trim()] = { capacity: r.capacity, costPerHour: r.costPerHour, timetableId: r.timetableId || undefined };
    const cfgDelays: NonNullable<SimConfig["delays"]> = {};
    for (const [id, d] of Object.entries(delays)) if (d.mean > 0) cfgDelays[id] = toDistribution(d);
    const cfgBoundaries: NonNullable<SimConfig["boundaries"]> = {};
    for (const [id, d] of Object.entries(boundaries)) if (d.mean > 0) cfgBoundaries[id] = toDistribution(d);
    const cfgTimetables: NonNullable<SimConfig["timetables"]> = {};
    for (const tt of timetables) cfgTimetables[tt.id] = tt;

    const config: SimConfig = {
      instances,
      arrival: toDistribution(arrival),
      defaultTask: { kind: "exponential", mean: defaultMean },
      transferTime,
      tasks: cfgTasks,
      delays: cfgDelays,
      boundaries: cfgBoundaries,
      gateways: weights,
      resources: cfgRes,
      timetables: cfgTimetables,
      startDateMs: new Date(startDate).getTime() || Date.now(),
      warmupPercent: warmup,
      currency,
      seed: 12345,
    };

    const res = runSimulation(graph, config);
    setResult(res); setHasRun(true); setSection("results");
    // Persiste resumen (IA) y datos estructurados (export Excel) del escenario
    try { localStorage.setItem(summaryKey(scenario, processId), buildResultText(res)); } catch { /* ok */ }
    try { localStorage.setItem(exportKey(scenario, processId), JSON.stringify(buildExportData(res))); } catch { /* ok */ }
    const anim = animatorRef.current;
    if (anim) { anim.load(res.segments, res.maxTime); anim.setSpeed(speed); anim.play(); }
  }

  // ── Resúmenes de texto para alimentar a la IA ───────────────────────────────
  function buildDiagramText(): string {
    const L: string[] = [`Diagrama (${scenarioLabel}): ${taskNodes.length} tareas, ${gatewayNodes.length} compuertas, ${eventNodes.length} eventos, ${boundaryNodes.length} eventos de borde.`];
    if (taskNodes.length) L.push("Tareas: " + taskNodes.map((n) => `"${n.name || n.id}"`).join(", "));
    if (gatewayNodes.length) L.push("Compuertas (decisiones): " + gatewayNodes.map((g) => `"${g.name || g.id}" (${g.outgoing.length} ramas)`).join(", "));
    if (eventNodes.length) L.push("Eventos/esperas: " + eventNodes.map((e) => `"${e.name || e.id}"`).join(", "));
    if (boundaryNodes.length) L.push("Eventos de borde: " + boundaryNodes.map((b) => `"${b.name || b.id}" en "${b.attachedTo ? (graph.nodes.get(b.attachedTo)?.name ?? b.attachedTo) : "?"}"`).join(", "));
    return L.join("\n");
  }
  function buildResultText(r: SimResult): string {
    const L: string[] = [
      `Resultados de simulación (${scenarioLabel}):`,
      `- Instancias completadas: ${r.completed}/${r.started}`,
      `- Cycle time medio (reloj): ${fmtTime(r.avgCycle)} (mín ${fmtTime(r.minCycle)}, máx ${fmtTime(r.maxCycle)})`,
      `- Cycle time hábil (sin off-horario): ${fmtTime(r.avgCycleExcl)}`,
      `- Tiempo de proceso medio: ${fmtTime(r.avgProcessing)} · espera media: ${fmtTime(r.avgWaiting)}`,
      `- Eficiencia (proc/cycle): ${(r.cycleEfficiency * 100).toFixed(1)}% · throughput: ${r.throughputPerHour.toFixed(2)}/h · costo total: ${r.currency} ${r.totalCost.toFixed(2)}`,
      `Por actividad (visitas · proc · espera · costo):`,
      ...r.activities.slice(0, 12).map((a) => `  · ${a.name}: ${a.visits} · ${fmtTime(a.visits ? a.totalProcessing / a.visits : 0)} · ${fmtTime(a.visits ? a.totalWaiting / a.visits : 0)} · ${r.currency}${a.cost.toFixed(2)}`),
    ];
    if (r.resources.length) L.push("Recursos (utilización): " + r.resources.map((rs) => `${rs.name} ${(rs.utilization * 100).toFixed(0)}%`).join(", "));
    return L.join("\n");
  }

  // ── Exportación a Excel (AS-IS / TO-BE) ─────────────────────────────────────
  function buildExportData(res: SimResult): SimExportData {
    const name = (processName || "").trim() || "Proceso";
    return {
      scenarioLabel, name, currency: res.currency,
      completed: res.completed, started: res.started,
      avgCycle: res.avgCycle, minCycle: res.minCycle, maxCycle: res.maxCycle, avgCycleExcl: res.avgCycleExcl,
      avgProcessing: res.avgProcessing, avgWaiting: res.avgWaiting, avgTransfer: res.avgTransfer,
      cycleEfficiency: res.cycleEfficiency, throughputPerHour: res.throughputPerHour, totalCost: res.totalCost,
      activities: res.activities.map((a) => ({ name: a.name, visits: a.visits, proc: a.visits ? a.totalProcessing / a.visits : 0, wait: a.visits ? a.totalWaiting / a.visits : 0, cost: a.cost, durOver: a.durOverThreshold, costOver: a.costOverThreshold })),
      resources: res.resources.map((rs) => ({ name: rs.name, capacity: rs.capacity, utilization: rs.utilization, cost: rs.cost })),
    };
  }
  const fileSafe = (s: string) => s.replace(/[^\w-]+/g, "_").slice(0, 40) || "proceso";

  function exportCurrent() {
    if (!result) return;
    const d = buildExportData(result);
    downloadXls(`Simulacion_${fileSafe(d.name)}_${scenario ?? "escenario"}`, [stackedSheet(d.scenarioLabel, d)]);
  }

  function exportBoth() {
    if (!result) return;
    const cur = buildExportData(result);
    try { localStorage.setItem(exportKey(scenario, processId), JSON.stringify(cur)); } catch { /* ok */ }
    const otherScenario = scenario === "asis" ? "tobe" : "asis";
    let other: SimExportData | null = null;
    try { const raw = localStorage.getItem(exportKey(otherScenario, processId)); if (raw) other = JSON.parse(raw) as SimExportData; } catch { /* ok */ }
    if (!other) {
      alert(`Primero ejecuta la simulación del ${otherScenario === "asis" ? "AS-IS" : "TO-BE"} (en la otra pestaña) para exportar ambos escenarios.`);
      return;
    }
    const asis = scenario === "asis" ? cur : other;
    const tobe = scenario === "asis" ? other : cur;
    downloadXls(`Simulacion_${fileSafe(cur.name)}_ASIS-vs-TOBE`, [comparisonSheet(asis, tobe), stackedSheet("AS-IS", asis), stackedSheet("TO-BE", tobe)]);
  }

  async function askAi(title: string, query: string, includeResult: boolean, extra?: string) {
    setSection("ia"); setAiBusy(true); setAiError(null); setAiTitle(title); setAiAnswer(null);
    let context = buildDiagramText();
    if (includeResult && result) context += "\n\n" + buildResultText(result);
    if (extra) context += "\n\n" + extra;
    try {
      const res = await expertAsk({ query, role: AI_ROLE, context });
      if (res.success) setAiAnswer(res.answer);
      else setAiError(res.error ?? "Sin respuesta del asistente.");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  function askCompare() {
    const me = result ? buildResultText(result) : localStorage.getItem(summaryKey(scenario, processId));
    const otherScenario = scenario === "asis" ? "tobe" : "asis";
    const other = localStorage.getItem(summaryKey(otherScenario, processId));
    if (!other) {
      setSection("ia"); setAiTitle("Comparar AS-IS vs TO-BE"); setAiAnswer(null);
      setAiError(`Primero ejecuta la simulación del ${otherScenario === "asis" ? "AS-IS" : "TO-BE"} (en la otra pestaña) para poder comparar.`);
      return;
    }
    if (!me) { setSection("ia"); setAiError("Ejecuta primero esta simulación."); return; }
    const asis = scenario === "asis" ? me : other;
    const tobe = scenario === "asis" ? other : me;
    void askAi(
      "Comparar AS-IS vs TO-BE",
      "Compara los resultados de la simulación AS-IS contra el TO-BE. Cuantifica las diferencias (cycle time, espera, costo, eficiencia, utilización), di qué mejoró y qué empeoró, y concluye si el rediseño TO-BE vale la pena y qué ajustar.",
      false,
      `=== AS-IS ===\n${asis}\n\n=== TO-BE ===\n${tobe}`,
    );
  }

  function addResource() {
    setResources((r) => [...r, { name: `Recurso ${r.length + 1}`, capacity: 1, costPerHour: 20, timetableId: "default" }]);
  }
  function addTimetable() {
    setTimetables((t) => [...t, { id: `tt_${Date.now()}`, name: `Horario ${t.length + 1}`, beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020 }]);
  }

  const resourceNames = resources.map((r) => r.name.trim()).filter(Boolean);
  const selected = selectedId ? graph.nodes.get(selectedId) ?? null : null;

  // ── campos reutilizables ────────────────────────────────────────────────────
  function TaskEditor({ n, full }: { n: SimNode; full: boolean }) {
    const c = tasks[n.id]; if (!c) return null;
    const set = (patch: Partial<TaskCfg>) => setTasks((t) => ({ ...t, [n.id]: { ...c, ...patch } }));
    return (
      <div className="sim-el-fields">
        <label className="sim-inline"><span>Duración</span></label>
        <DistributionEditor value={c.dur} onChange={(d) => set({ dur: d })} />
        <label className="sim-inline"><span>Recurso</span>
          <select value={c.resource} onChange={(e) => set({ resource: e.target.value })}>
            <option value="">Sin recurso (24/7)</option>
            {resourceNames.map((rn) => <option key={rn} value={rn}>{rn}</option>)}
          </select>
        </label>
        {full && (
          <>
            <div className="sim-grid2">
              <label className="sim-inline"><span>Costo fijo</span>
                <input type="number" min={0} step="any" value={c.fixedCost} onChange={(e) => set({ fixedCost: Number(e.target.value) })} />
              </label>
              <label className="sim-inline"><span>Umbral costo</span>
                <input type="number" min={0} step="any" value={c.costThreshold} onChange={(e) => set({ costThreshold: Number(e.target.value) })} />
              </label>
            </div>
            <div className="sim-grid2">
              <label className="sim-inline"><span>Umbral duración</span>
                <input type="number" min={0} step="any" value={c.durThreshold} onChange={(e) => set({ durThreshold: Number(e.target.value) })} />
              </label>
              <label className="sim-inline"><span>Unidad</span>
                <select value={c.durThresholdUnit} onChange={(e) => set({ durThresholdUnit: e.target.value as TimeUnit })}>
                  {Object.entries(TIME_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
          </>
        )}
      </div>
    );
  }

  function GatewayEditor({ g }: { g: SimNode }) {
    return (
      <div className="sim-el-fields">
        {g.outgoing.map((f) => (
          <label key={f} className="sim-gw-row">
            <span title={flowLabel(f)}>{flowLabel(f)}</span>
            <input type="number" min={0} max={1} step={0.05} value={weights[g.id]?.[f] ?? 0}
              onChange={(e) => setWeights((w) => ({ ...w, [g.id]: { ...w[g.id], [f]: Number(e.target.value) } }))} />
          </label>
        ))}
      </div>
    );
  }

  function DelayEditor({ n }: { n: SimNode }) {
    const d = delays[n.id] ?? newDist(0, "minutes", "fixed");
    return (
      <div className="sim-el-fields">
        <label className="sim-inline"><span>Demora</span></label>
        <DistributionEditor value={d} onChange={(v) => setDelays((x) => ({ ...x, [n.id]: v }))} />
      </div>
    );
  }

  function BoundaryEditor({ n }: { n: SimNode }) {
    const d = boundaries[n.id] ?? newDist(0, "minutes", "fixed");
    const host = n.attachedTo ? graph.nodes.get(n.attachedTo) : null;
    return (
      <div className="sim-el-fields">
        <label className="sim-inline"><span>Duración del evento</span></label>
        <DistributionEditor value={d} onChange={(v) => setBoundaries((x) => ({ ...x, [n.id]: v }))} />
        <p className="sim-hint-mini">
          Compite contra <b>{host?.name || "la actividad"}</b>. Si su tiempo es <b>menor</b>, {n.interrupting === false ? "lanza una rama paralela (no interrumpe)" : "interrumpe y el token sale por la excepción"}. 0 = nunca dispara.
        </p>
      </div>
    );
  }

  function SelectedEditor({ n }: { n: SimNode }) {
    const title = n.name || n.bpmnType.replace("bpmn:", "");
    return (
      <section className="sim-sec sim-selected-card">
        <div className="sim-selected-head">
          <span className="sim-selected-kind">
            {n.kind === "task" ? <Activity size={13} /> : n.kind === "boundary" ? <TriggerIcon t={n.trigger} /> : n.kind === "event" ? <Clock size={13} /> : <GitBranch size={13} />}
            {n.kind === "task" ? "Tarea" : n.kind === "boundary" ? `Evento de borde · ${TRIGGER_LABEL[n.trigger ?? "none"]}` : n.kind === "event" ? "Evento / espera" : "Compuerta"}
          </span>
          <button className="sim-icon-btn" title="Cerrar" onClick={() => setSelectedId(null)}><ChevronUp size={14} /></button>
        </div>
        <div className="sim-selected-name" title={title}>{title}</div>
        {n.kind === "task" && <TaskEditor n={n} full />}
        {(n.kind === "xor" || n.kind === "or") && <GatewayEditor g={n} />}
        {n.kind === "event" && <DelayEditor n={n} />}
        {n.kind === "boundary" && <BoundaryEditor n={n} />}
      </section>
    );
  }

  const compactRow = (n: SimNode, summary: string, icon: ReactNode) => (
    <div key={n.id} className={`sim-list-row ${selectedId === n.id ? "is-selected" : ""}`} onClick={() => setSelectedId(n.id)}>
      <div className="sim-list-name" title={n.name}>{icon}<span>{n.name || n.bpmnType.replace("bpmn:", "")}</span></div>
      <span className="sim-list-sum">{summary}</span>
    </div>
  );

  return (
    <div className="sim-panel">
      <header className="sim-panel-head">
        <div className="sim-panel-title"><Zap size={15} /> Simulación de procesos</div>
        <button className="sim-icon-btn" onClick={onClose} title="Cerrar simulación"><X size={15} /></button>
      </header>

      <div className="sim-transport">
        <button className="sim-play" onClick={() => animatorRef.current?.toggle()} disabled={!hasRun}>
          {tick.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="sim-icon-btn" onClick={() => animatorRef.current?.reset()} disabled={!hasRun} title="Reiniciar"><RotateCcw size={15} /></button>
        <div className="sim-clock">
          <span className="sim-clock-time">{fmtTime(tick.time)}</span>
          <span className="sim-clock-sub">{tick.liveTokens} en curso · {result?.completed ?? 0} fin</span>
        </div>
        <input className="sim-scrub" type="range" min={0} max={1000} value={Math.round(tick.progress * 1000)}
          onChange={(e) => { const r = result; if (r) animatorRef.current?.seek((Number(e.target.value) / 1000) * r.maxTime); }}
          disabled={!hasRun} />
      </div>
      <div className="sim-speed">
        <Gauge size={13} /><span>Velocidad</span>
        <input type="range" min={2} max={200} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        <span className="sim-speed-val">{speed} min/s</span>
      </div>

      <button className="sim-run-btn" onClick={run}><Play size={14} /> {hasRun ? "Volver a ejecutar" : "Ejecutar simulación"}</button>

      <div className="sim-tabs">
        <button className={section === "config" ? "active" : ""} onClick={() => setSection("config")}>Configuración</button>
        <button className={section === "results" ? "active" : ""} onClick={() => setSection("results")} disabled={!result}>Resultados</button>
        <button className={`sim-tab-ia ${section === "ia" ? "active" : ""}`} onClick={() => setSection("ia")}><Sparkles size={12} /> IA</button>
      </div>

      <div className="sim-scroll">
        {section === "config" && (
          <>
            {selected ? <SelectedEditor n={selected} /> : (
              <div className="sim-clickhint">
                <MousePointerClick size={15} />
                <span>Haz clic en una <b>tarea</b>, <b>compuerta</b> o <b>evento</b> del diagrama para editar todos sus datos aquí.</span>
              </div>
            )}

            {/* Escenario global */}
            <section className="sim-sec">
              <h4><Activity size={13} /> Escenario</h4>
              <label className="sim-field">Nº de instancias <span className="sim-tag-free">sin límite</span>
                <input type="number" min={1} step={10} value={instances} onChange={(e) => setInstances(Number(e.target.value))} />
              </label>
              <div className="sim-subhead">Tiempo entre llegadas</div>
              <DistributionEditor value={arrival} onChange={setArrival} />
              <div className="sim-grid2" style={{ marginTop: 8 }}>
                <label className="sim-field">% warmup (excluir)
                  <input type="number" min={0} max={95} step={1} value={warmup} onChange={(e) => setWarmup(Number(e.target.value))} />
                </label>
                <label className="sim-field"><Coins size={11} /> Moneda
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className="sim-field"><CalendarDays size={11} /> Inicio del escenario
                <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <div className="sim-grid2">
                <label className="sim-field">Traslado/flujo (min)
                  <input type="number" min={0} step={0.1} value={transferTime} onChange={(e) => setTransferTime(Number(e.target.value))} />
                </label>
                <label className="sim-field">Duración def. (min)
                  <input type="number" min={0} step={1} value={defaultMean} onChange={(e) => setDefaultMean(Number(e.target.value))} />
                </label>
              </div>
            </section>

            {/* Recursos */}
            <section className="sim-sec">
              <h4><Boxes size={13} /> Recursos</h4>
              <div className="sim-res-head"><span>Nombre</span><span># </span><span>$/h</span><span>Horario</span><span /></div>
              {resources.map((r, i) => (
                <div key={i} className="sim-res-row">
                  <input className="sim-res-name" value={r.name} onChange={(e) => setResources((rs) => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input type="number" min={1} title="capacidad" value={r.capacity} onChange={(e) => setResources((rs) => rs.map((x, j) => j === i ? { ...x, capacity: Number(e.target.value) } : x))} />
                  <input type="number" min={0} title="costo/hora" value={r.costPerHour} onChange={(e) => setResources((rs) => rs.map((x, j) => j === i ? { ...x, costPerHour: Number(e.target.value) } : x))} />
                  <select title="horario laboral" value={r.timetableId} onChange={(e) => setResources((rs) => rs.map((x, j) => j === i ? { ...x, timetableId: e.target.value } : x))}>
                    {timetables.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
                  </select>
                  <button className="sim-icon-btn" onClick={() => setResources((rs) => rs.filter((_, j) => j !== i))}><X size={13} /></button>
                </div>
              ))}
              <button className="sim-add" onClick={addResource}>+ Añadir recurso</button>
            </section>

            {/* Timetables */}
            <section className="sim-sec">
              <h4><CalendarDays size={13} /> Horarios de trabajo</h4>
              <p className="sim-empty" style={{ marginBottom: 6 }}>Las tareas con recurso sólo avanzan en su horario; el cycle time incluye noches/fines de semana.</p>
              {timetables.map((tt, i) => (
                <div key={tt.id} className="sim-tt-row">
                  <input className="sim-tt-name" value={tt.name} onChange={(e) => setTimetables((ts) => ts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <div className="sim-tt-fields">
                    <select value={tt.beginDay} title="día inicio" onChange={(e) => setTimetables((ts) => ts.map((x, j) => j === i ? { ...x, beginDay: Number(e.target.value) } : x))}>
                      {DAY_LABELS.map((d, k) => <option key={k} value={k}>{d.slice(0, 3)}</option>)}
                    </select>
                    <select value={tt.endDay} title="día fin" onChange={(e) => setTimetables((ts) => ts.map((x, j) => j === i ? { ...x, endDay: Number(e.target.value) } : x))}>
                      {DAY_LABELS.map((d, k) => <option key={k} value={k}>{d.slice(0, 3)}</option>)}
                    </select>
                    <input type="time" value={minToHHMM(tt.beginMin)} title="hora inicio" onChange={(e) => setTimetables((ts) => ts.map((x, j) => j === i ? { ...x, beginMin: hhmmToMin(e.target.value) } : x))} />
                    <input type="time" value={minToHHMM(tt.endMin)} title="hora fin" onChange={(e) => setTimetables((ts) => ts.map((x, j) => j === i ? { ...x, endMin: hhmmToMin(e.target.value) } : x))} />
                    <button className="sim-icon-btn" onClick={() => setTimetables((ts) => ts.filter((_, j) => j !== i))}><X size={13} /></button>
                  </div>
                </div>
              ))}
              <button className="sim-add" onClick={addTimetable}>+ Añadir horario</button>
            </section>

            {/* Tareas (lista compacta) */}
            <section className="sim-sec">
              <h4><Activity size={13} /> Tareas ({taskNodes.length})</h4>
              {taskNodes.length === 0 && <p className="sim-empty">No hay tareas en el diagrama.</p>}
              {taskNodes.map((n) => compactRow(n, tasks[n.id] ? distSummary(tasks[n.id].dur) : "", <Activity size={12} />))}
            </section>

            {boundaryNodes.length > 0 && (
              <section className="sim-sec">
                <h4><ShieldAlert size={13} /> Eventos de borde ({boundaryNodes.length})</h4>
                <p className="sim-empty" style={{ marginBottom: 6 }}>Modelo de carrera: sólo <b>duración</b>, sin probabilidad.</p>
                {boundaryNodes.map((n) => compactRow(n, boundaries[n.id] ? distSummary(boundaries[n.id]) : "", <TriggerIcon t={n.trigger} size={12} />))}
              </section>
            )}

            {eventNodes.length > 0 && (
              <section className="sim-sec">
                <h4><Clock size={13} /> Eventos / esperas ({eventNodes.length})</h4>
                {eventNodes.map((n) => compactRow(n, delays[n.id] ? distSummary(delays[n.id]) : "", <Clock size={12} />))}
              </section>
            )}

            {gatewayNodes.length > 0 && (
              <section className="sim-sec">
                <h4><GitBranch size={13} /> Compuertas ({gatewayNodes.length})</h4>
                {gatewayNodes.map((g) => compactRow(g, `${g.outgoing.length} ramas`, <GitBranch size={12} />))}
              </section>
            )}
          </>
        )}

        {section === "results" && result && (
          <ResultsView
            result={result}
            onInterpret={() => void askAi("Interpretación de resultados", `Interpreta los resultados de la simulación de ${scenarioLabel}. Identifica cuellos de botella, esperas, sobrecostos y baja eficiencia con base en los números, y di concretamente QUÉ se puede mejorar y por qué.`, true)}
            onExport={exportCurrent}
            onExportBoth={exportBoth}
          />
        )}

        {section === "ia" && (
          <div className="sim-ia">
            <div className="sim-ia-intro">
              <Brain size={16} />
              <p>Asistente de simulación para <b>{scenarioLabel}</b>. Te ayuda a entender y llenar los datos, interpretar resultados y mejorar el proceso.</p>
            </div>
            <div className="sim-ia-actions">
              <button className="sim-ia-btn" disabled={aiBusy} onClick={() => void askAi("Ayuda para llenar los datos", "Explícame en términos simples qué significa cada dato que debo llenar para simular ESTE diagrama (llegadas, distribución, duración por tarea, recursos, compuertas, eventos de borde, horarios). Luego sugiéreme valores razonables para cada tarea, compuerta y evento según sus nombres. Sé concreto y por elemento.", false)}>
                <Wand2 size={14} /> Ayúdame a llenar los datos
              </button>
              <button className="sim-ia-btn" disabled={aiBusy || !result} onClick={() => void askAi("Interpretación de resultados", `Interpreta los resultados de la simulación de ${scenarioLabel}. Identifica cuellos de botella, esperas, sobrecostos y baja eficiencia con base en los números, y di concretamente QUÉ mejorar y por qué.`, true)}>
                <Lightbulb size={14} /> Interpretar resultados {result ? "" : "(ejecuta primero)"}
              </button>
              <button className="sim-ia-btn" disabled={aiBusy} onClick={() => void askAi("Metodología de mejora", "Con base en este proceso y sus resultados (si los hay), recomiéndame qué metodología/herramienta de mejora usar: Lean (¿qué mudas?), Six Sigma/DMAIC, Teoría de Restricciones, BPR/rediseño o automatización RPA. Di cuál priorizar, por qué, y los próximos pasos concretos.", true)}>
                <Activity size={14} /> ¿Qué metodología de mejora usar?
              </button>
              <button className="sim-ia-btn sim-ia-btn-compare" disabled={aiBusy} onClick={askCompare}>
                <GitCompare size={14} /> Comparar AS-IS vs TO-BE
              </button>
            </div>

            {aiBusy && <div className="sim-ia-loading"><Loader2 size={14} className="spin" /> Consultando al asistente…</div>}
            {aiError && !aiBusy && <div className="sim-warn">⚠ {aiError}</div>}
            {aiAnswer && !aiBusy && (
              <div className="sim-ia-answer">
                {aiTitle && <h4 className="sim-ia-answer-title">{aiTitle}</h4>}
                <ChatMarkdown content={aiAnswer} />
              </div>
            )}
            {!aiBusy && !aiAnswer && !aiError && (
              <p className="sim-empty" style={{ marginTop: 10 }}>Elige una acción para que el asistente te ayude.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsView({ result, onInterpret, onExport, onExportBoth }: { result: SimResult; onInterpret: () => void; onExport: () => void; onExportBoth: () => void }) {
  const cur = result.currency;
  const kpis: Array<[string, string]> = [
    ["Cycle time (reloj)", fmtTime(result.avgCycle)],
    ["Cycle time hábil", fmtTime(result.avgCycleExcl)],
    ["Cycle min / máx", `${fmtTime(result.minCycle)} / ${fmtTime(result.maxCycle)}`],
    ["Tiempo de proceso", fmtTime(result.avgProcessing)],
    ["Tiempo de espera", fmtTime(result.avgWaiting)],
    ["Eficiencia", `${(result.cycleEfficiency * 100).toFixed(1)} %`],
    ["Throughput", `${result.throughputPerHour.toFixed(2)} /h`],
    ["Costo total", `${cur} ${result.totalCost.toFixed(2)}`],
    ["Completados", `${result.completed} / ${result.started}`],
  ];
  return (
    <div className="sim-results">
      <div className="sim-results-toolbar">
        <button className="sim-ia-inline-btn" onClick={onInterpret}><Sparkles size={13} /> Interpretar con IA</button>
        <button className="sim-xls-btn" onClick={onExport} title="Exportar este escenario a Excel"><FileSpreadsheet size={13} /> Excel</button>
        <button className="sim-xls-btn" onClick={onExportBoth} title="Exportar AS-IS + TO-BE con comparación"><FileSpreadsheet size={13} /> AS-IS + TO-BE</button>
      </div>
      {result.warnings.length > 0 && <div className="sim-warn">{result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
      <div className="sim-kpi-grid">
        {kpis.map(([k, v]) => (
          <div key={k} className="sim-kpi"><span className="sim-kpi-val">{v}</span><span className="sim-kpi-label">{k}</span></div>
        ))}
      </div>

      <h4 className="sim-res-h">Por actividad (cuello de botella / umbrales)</h4>
      <table className="sim-table">
        <thead><tr><th>Actividad</th><th>Visitas</th><th>Proc.</th><th>Espera</th><th>Costo</th><th title="excesos de duración / costo sobre umbral">{'>'}umbral</th></tr></thead>
        <tbody>
          {result.activities.map((a) => (
            <tr key={a.id}>
              <td title={a.name}>{a.name}</td>
              <td>{a.visits}</td>
              <td>{fmtTime(a.visits ? a.totalProcessing / a.visits : 0)}</td>
              <td>{fmtTime(a.visits ? a.totalWaiting / a.visits : 0)}</td>
              <td>{cur} {a.cost.toFixed(2)}</td>
              <td>{a.durOverThreshold || a.costOverThreshold ? `${a.durOverThreshold}d / ${a.costOverThreshold}c` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.resources.length > 0 && (
        <>
          <h4 className="sim-res-h">Utilización de recursos</h4>
          <table className="sim-table">
            <thead><tr><th>Recurso</th><th>Cap.</th><th>Utilización</th><th>Costo</th></tr></thead>
            <tbody>
              {result.resources.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td><td>{r.capacity}</td>
                  <td><div className="sim-util-bar"><div style={{ width: `${(r.utilization * 100).toFixed(0)}%` }} /></div>{(r.utilization * 100).toFixed(0)}%</td>
                  <td>{cur} {r.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
