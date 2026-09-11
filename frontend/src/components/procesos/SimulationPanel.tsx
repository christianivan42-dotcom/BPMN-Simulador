import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Play, Pause, RotateCcw, X, Gauge, Activity, Boxes, GitBranch, Zap, Clock, MousePointerClick, ShieldAlert, Timer, Mail, AlertTriangle, ChevronUp, CalendarDays, Coins, Brain, Sparkles, Lightbulb, Wand2, GitCompare, Loader2, FileSpreadsheet, Stethoscope, Scale, Calculator, ClipboardList } from "lucide-react";
import { buildSimGraph, type SimGraph, type SimNode, type EventTrigger } from "../../bpmn/sim/simGraph";
import { runSimulation, type SimConfig, type SimResult } from "../../bpmn/sim/simEngine";
import { TokenAnimator, type AnimatorTick } from "../../bpmn/sim/tokenAnimator";
import { DISTRIBUTION_LABELS, DISTRIBUTION_PARAMS, PARAM_LABELS, expectedValue, type DistributionKind, type Distribution, type DistParam } from "../../bpmn/sim/distributions";
import { TIME_UNIT_LABELS, UNIT_TO_MIN, type TimeUnit } from "../../bpmn/sim/units";
import { defaultScenarioStart, defaultTimetables, timetableIssue, type Timetable } from "../../bpmn/sim/calendar";
import { headcount, type Shift } from "../../bpmn/sim/shifts";
import { analyzeScenario, compareScenarios, fmtDuration, renderDataGuide, renderDiagnosis, renderMethodology, renderVerdict, type ScenarioAnalysis, type ScenarioData } from "../../bpmn/sim/simAnalysis";
import { expertAsk } from "../../api";
import { ChatMarkdown } from "../ChatMarkdown";
import { downloadXls, cell, hdr, title, sub, type XlsSheet } from "../../bpmn/sim/simExport";
import { safeGet, safeSet } from "../../lib/storage";

interface Modeler { get: (name: string) => unknown; }

// ── Exportación a Excel ──────────────────────────────────────────────────────
interface SimExportData {
  scenarioLabel: string; name: string; currency: string;
  completed: number; started: number;
  avgCycle: number; minCycle: number; maxCycle: number; avgCycleExcl: number;
  avgProcessing: number; avgWaiting: number; avgIdle: number; avgTransfer: number;
  cycleEfficiency: number; throughputPerHour: number; totalCost: number;
  activities: Array<{ name: string; visits: number; proc: number; wait: number; idle: number; cost: number; durOver: number; costOver: number }>;
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
    ["Tiempo de espera medio (cola + demoras)", r2(d.avgWaiting), "min"],
    ["Tiempo inactivo (fuera de horario)", r2(d.avgIdle), "min"],
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
    [hdr("Actividad"), hdr("Visitas"), hdr("Proc. medio (min)"), hdr("Espera media (min)"), hdr("Inactividad media (min)"), hdr(`Costo (${d.currency})`), hdr("Excede duración"), hdr("Excede costo")],
    ...d.activities.map((a) => [cell(a.name), cell(a.visits), cell(r2(a.proc)), cell(r2(a.wait)), cell(r2(a.idle)), cell(r2(a.cost)), cell(a.durOver), cell(a.costOver)]),
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

// El backend limita `context` a 8000 caracteres (ExpertAskRequest). Pasarse
// devolvía un 422 y el usuario solo veía "expertAsk failed: 422".
const MAX_AI_CONTEXT = 7500;

function clampContext(text: string): string {
  if (text.length <= MAX_AI_CONTEXT) return text;
  return text.slice(0, MAX_AI_CONTEXT - 80) + "\n\n[…contexto recortado por longitud…]";
}

// La simulación corre de forma síncrona en el hilo de la interfaz: por encima
// de este número de instancias la pestaña se queda congelada varios segundos,
// así que se pide confirmación antes.
const INSTANCES_WARN_THRESHOLD = 20_000;

const AI_ROLE =
  "Eres un consultor SENIOR experto en simulación cuantitativa de procesos de negocio y en mejora/rediseño de procesos " +
  "(Lean — 7 mudas y VSM —, Six Sigma/DMAIC, Teoría de Restricciones, BPR y automatización RPA). " +
  "Analizas el diagrama y los datos de simulación como un experto: razonas sobre cuellos de botella, esperas, utilización de recursos, costos y eficiencia, y traduces los números en decisiones. " +
  "REGLAS de respuesta: en español; SIEMPRE con secciones y viñetas claras; CITA los números concretos del proceso (cycle time, espera, costo, %); sé decidido y accionable; evita generalidades vacías. " +
  "Tu audiencia son analistas que no dominan la simulación. " +
  "Si el contexto trae un ANÁLISIS CALCULADO POR EL SIMULADOR, sus cifras son la fuente de verdad: cítalas tal cual y no inventes otras.";

/** Proveedor que devuelve el backend cuando no hay ningún modelo configurado. */
const MOCK_PROVIDER = "mock_local";

const summaryKey = (scenario: string | undefined, companyId: string | undefined) =>
  `bpms_sim_summary_${scenario ?? "x"}_${companyId ?? "x"}`;

/** Propuesta de TO-BE obtenida en el AS-IS, para consultarla al diseñar el TO-BE. */
const proposalKey = (processId: string | undefined) => `bpms_sim_proposal_${processId ?? "x"}`;

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
interface ResourceRow { name: string; capacity: number; costPerHour: number; timetableId: string; shifts: Shift[]; }

/** Valor del selector de horario que activa los turnos del recurso. */
const SHIFTS_ID = "__turnos__";

/** Punto de partida al elegir «Turnos»: tres jornadas de 8 h, todos los días. */
function threeShifts(people: number): Shift[] {
  const n = Math.max(1, Math.floor(people) || 1);
  return [
    { beginDay: 0, endDay: 6, beginMin: 360, endMin: 840, capacity: n },
    { beginDay: 0, endDay: 6, beginMin: 840, endMin: 1320, capacity: n },
    { beginDay: 0, endDay: 6, beginMin: 1320, endMin: 360, capacity: n },
  ];
}

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const CURRENCIES = ["$", "USD", "EUR", "MXN", "COP", "PEN", "CLP", "ARS"];

// Redondea antes de partir en horas y minutos: la versión anterior mostraba
// cosas como "1h 60m" o "0d 24h".
const fmtTime = fmtDuration;
function minToHHMM(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function defaultStartDate(): string {
  // Lunes de esta semana a las 9:00. Con "hoy a las 9:00" los resultados
  // cambiaban según el día en que se abría el panel.
  const d = defaultScenarioStart();
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

// -- Editores del elemento seleccionado --------------------------------------
// IMPORTANTE: deben declararse a nivel de modulo. Si se definen dentro del
// componente padre, su identidad cambia en cada render y React desmonta el
// subarbol completo: los inputs se recrean y pierden el foco tras cada tecla.

function TaskEditor({ cfg, full, resourceNames, onPatch }: {
  cfg: TaskCfg;
  full: boolean;
  resourceNames: string[];
  onPatch: (patch: Partial<TaskCfg>) => void;
}) {
  return (
    <div className="sim-el-fields">
      <label className="sim-inline"><span>Duración</span></label>
      <DistributionEditor value={cfg.dur} onChange={(d) => onPatch({ dur: d })} />
      <label className="sim-inline"><span>Recurso</span>
        <select value={cfg.resource} onChange={(e) => onPatch({ resource: e.target.value })}>
          <option value="">Sin recurso (24/7)</option>
          {resourceNames.map((rn) => <option key={rn} value={rn}>{rn}</option>)}
        </select>
      </label>
      {full && (
        <>
          <div className="sim-grid2">
            <label className="sim-inline"><span>Costo fijo</span>
              <input type="number" min={0} step="any" value={cfg.fixedCost}
                onChange={(e) => onPatch({ fixedCost: Number(e.target.value) })} />
            </label>
            <label className="sim-inline"><span>Umbral costo</span>
              <input type="number" min={0} step="any" value={cfg.costThreshold}
                onChange={(e) => onPatch({ costThreshold: Number(e.target.value) })} />
            </label>
          </div>
          <div className="sim-grid2">
            <label className="sim-inline"><span>Umbral duración</span>
              <input type="number" min={0} step="any" value={cfg.durThreshold}
                onChange={(e) => onPatch({ durThreshold: Number(e.target.value) })} />
            </label>
            <label className="sim-inline"><span>Unidad</span>
              <select value={cfg.durThresholdUnit}
                onChange={(e) => onPatch({ durThresholdUnit: e.target.value as TimeUnit })}>
                {Object.entries(TIME_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
        </>
      )}
    </div>
  );
}

function GatewayEditor({ node, weights, flowLabel, onWeight }: {
  node: SimNode;
  weights: Record<string, number>;
  flowLabel: (flowId: string) => string;
  onWeight: (flowId: string, value: number) => void;
}) {
  return (
    <div className="sim-el-fields">
      {node.outgoing.map((f) => (
        <label key={f} className="sim-gw-row">
          <span title={flowLabel(f)}>{flowLabel(f)}</span>
          <input type="number" min={0} max={1} step={0.05} value={weights?.[f] ?? 0}
            onChange={(e) => onWeight(f, Number(e.target.value))} />
        </label>
      ))}
    </div>
  );
}

function SingleDistEditor({ label, value, onChange, hint }: {
  label: string;
  value: DistInput;
  onChange: (d: DistInput) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="sim-el-fields">
      <label className="sim-inline"><span>{label}</span></label>
      <DistributionEditor value={value} onChange={onChange} />
      {hint && <p className="sim-hint-mini">{hint}</p>}
    </div>
  );
}

function SelectedEditor({
  node, taskCfg, resourceNames, onPatchTask,
  gatewayWeights, flowLabel, onWeight,
  delay, onDelay, boundary, onBoundary, hostName, onClose,
}: {
  node: SimNode;
  taskCfg: TaskCfg | undefined;
  resourceNames: string[];
  onPatchTask: (patch: Partial<TaskCfg>) => void;
  gatewayWeights: Record<string, number>;
  flowLabel: (flowId: string) => string;
  onWeight: (flowId: string, value: number) => void;
  delay: DistInput;
  onDelay: (d: DistInput) => void;
  boundary: DistInput;
  onBoundary: (d: DistInput) => void;
  hostName: string;
  onClose: () => void;
}) {
  const label = node.name || node.bpmnType.replace("bpmn:", "");
  const kindLabel =
    node.kind === "task" ? "Tarea"
    : node.kind === "boundary" ? `Evento de borde · ${TRIGGER_LABEL[node.trigger ?? "none"]}`
    : node.kind === "event" ? "Evento / espera"
    : "Compuerta";
  return (
    <section className="sim-sec sim-selected-card">
      <div className="sim-selected-head">
        <span className="sim-selected-kind">
          {node.kind === "task" ? <Activity size={13} />
            : node.kind === "boundary" ? <TriggerIcon t={node.trigger} />
            : node.kind === "event" ? <Clock size={13} />
            : <GitBranch size={13} />}
          {kindLabel}
        </span>
        <button className="sim-icon-btn" title="Cerrar" onClick={onClose}><ChevronUp size={14} /></button>
      </div>
      <div className="sim-selected-name" title={label}>{label}</div>
      {node.kind === "task" && taskCfg && (
        <TaskEditor cfg={taskCfg} full resourceNames={resourceNames} onPatch={onPatchTask} />
      )}
      {(node.kind === "xor" || node.kind === "or") && (
        <GatewayEditor node={node} weights={gatewayWeights} flowLabel={flowLabel} onWeight={onWeight} />
      )}
      {node.kind === "event" && (
        <SingleDistEditor label="Demora" value={delay} onChange={onDelay} />
      )}
      {node.kind === "boundary" && (
        <SingleDistEditor
          label="Duración del evento"
          value={boundary}
          onChange={onBoundary}
          hint={<>Compite contra <b>{hostName}</b>. Si su tiempo es <b>menor</b>, {node.interrupting === false ? "lanza una rama paralela (no interrumpe)" : "interrumpe y el token sale por la excepción"}. 0 = nunca dispara.</>}
        />
      )}
    </section>
  );
}

/** Turnos de un recurso: días de entrada, horas y personas de cada turno. */
function ShiftsEditor({ shifts, onChange }: { shifts: Shift[]; onChange: (shifts: Shift[]) => void }) {
  const patch = (k: number, p: Partial<Shift>) => onChange(shifts.map((s, j) => (j === k ? { ...s, ...p } : s)));
  return (
    <div className="sim-shifts">
      <div className="sim-shift-head"><span>Desde</span><span>Hasta</span><span>Entrada</span><span>Salida</span><span>Pers.</span><span /></div>
      {shifts.map((s, k) => (
        <div key={k} className="sim-shift-row">
          <select value={s.beginDay} title="primer día en que empieza el turno" onChange={(e) => patch(k, { beginDay: Number(e.target.value) })}>
            {DAY_LABELS.map((d, n) => <option key={n} value={n}>{d.slice(0, 3)}</option>)}
          </select>
          <select value={s.endDay} title="último día en que empieza el turno" onChange={(e) => patch(k, { endDay: Number(e.target.value) })}>
            {DAY_LABELS.map((d, n) => <option key={n} value={n}>{d.slice(0, 3)}</option>)}
          </select>
          <input type="time" value={minToHHMM(s.beginMin)} title="hora de entrada" onChange={(e) => patch(k, { beginMin: hhmmToMin(e.target.value) })} />
          <input type="time" value={minToHHMM(s.endMin)} title="hora de salida" onChange={(e) => patch(k, { endMin: hhmmToMin(e.target.value) })} />
          <input type="number" min={0} value={s.capacity} title="personas en el turno" onChange={(e) => patch(k, { capacity: Number(e.target.value) })} />
          <button className="sim-icon-btn" title="Quitar turno" onClick={() => onChange(shifts.filter((_, j) => j !== k))}><X size={13} /></button>
        </div>
      ))}
      <button className="sim-add" onClick={() => onChange([...shifts, { beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020, capacity: 1 }])}>+ Añadir turno</button>
      <p className="sim-hint-mini">
        Los días son aquellos en los que <b>empieza</b> el turno. Si la salida es anterior a la entrada, el turno
        acaba al día siguiente (22:00 → 06:00). En el relevo, las tareas a medias las continúa el turno entrante;
        si entra menos gente, las más recientes esperan en cola.
      </p>
    </div>
  );
}

interface AskOptions {
  /** Añade al contexto los resultados de la corrida actual. */
  includeResult?: boolean;
  extra?: string;
  /** Análisis del propio simulador: base del contexto y respuesta sin modelo. */
  computed?: () => string | null;
  /** Guarda la respuesta mostrada en esta clave del almacenamiento local. */
  saveTo?: string;
}

type AiSource = "llm" | "calculado";

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
  // Por defecto las solicitudes solo llegan en horario laboral.
  const [arrivalTimetableId, setArrivalTimetableId] = useState("default");
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
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [section, setSection] = useState<"config" | "results" | "ia">("config");

  // ── Asistente IA ────────────────────────────────────────────────────────────
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTitle, setAiTitle] = useState<string | null>(null);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  /** De dónde sale la respuesta mostrada: un modelo de lenguaje o el cálculo propio. */
  const [aiSource, setAiSource] = useState<AiSource | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  /** Análisis calculado que acompañó a una respuesta del modelo. */
  const [aiComputed, setAiComputed] = useState<string | null>(null);
  /** Configuración que produjo `result`: el análisis la re-simula con cambios. */
  const lastConfigRef = useRef<SimConfig | null>(null);
  const analysisRef = useRef<{ result: SimResult; analysis: ScenarioAnalysis } | null>(null);

  useEffect(() => {
    const anim = new TokenAnimator(modeler, graph);
    // El animador emite en cada frame (~60/s). Propagar eso al estado de React
    // volvía a renderizar el panel entero 60 veces por segundo y hacía
    // imposible escribir en los campos mientras corría la animación.
    let lastTick = 0;
    anim.onTick((t) => {
      const now = performance.now();
      const isEdge = !t.playing || t.progress >= 1;
      if (isEdge || now - lastTick >= 100) {
        lastTick = now;
        setTick(t);
      }
    });
    animatorRef.current = anim;
    return () => { anim.destroy(); animatorRef.current = null; };
  }, [modeler, graph]);

  useEffect(() => { animatorRef.current?.setSpeed(speed); }, [speed]);

  // ── selección por clic en el canvas ────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const eventBus = modeler.get("eventBus") as { on: (e: string, f: (ev: { element?: { id: string } }) => void) => void; off?: (e: string, f: unknown) => void };
    const handler = (ev: { element?: { id: string } }) => {
      const id = ev.element?.id;
      if (id && graph.nodes.has(id) && ["task", "xor", "or", "event", "boundary"].includes(graph.nodes.get(id)!.kind)) {
        setSelectedId(id); setSection("config");
      } else setSelectedId(null);
    };
    eventBus.on("element.click", handler);
    return () => { eventBus.off?.("element.click", handler); };
  }, [modeler, graph]);

  // Resalta en el diagrama el elemento en edición, se elija en el lienzo o en las
  // listas del panel. Antes solo lo hacía el clic en el lienzo: al elegir desde
  // una lista quedaba resaltado el elemento anterior.
  useEffect(() => {
    if (!selectedId) return;
    const canvas = modeler.get("canvas") as { addMarker: (id: string, c: string) => void; removeMarker: (id: string, c: string) => void };
    try { canvas.addMarker(selectedId, "sim-selected"); } catch { /* ok */ }
    return () => { try { canvas.removeMarker(selectedId, "sim-selected"); } catch { /* ok */ } };
  }, [modeler, selectedId]);

  function flowLabel(flowId: string): string {
    const f = graph.flows.get(flowId);
    if (!f) return flowId;
    const tgt = graph.nodes.get(f.target);
    return f.name || `→ ${tgt?.name || tgt?.bpmnType.replace("bpmn:", "") || flowId}`;
  }

  function run() {
    if (running) return;
    if (graph.starts.length === 0) { alert("El diagrama no tiene evento de inicio (Start Event). Añade uno para simular."); return; }

    // Horarios mal definidos (p. ej. cierre antes de la apertura) producían
    // tiempos absurdos y congelaban el motor; ahora se avisan y se ignoran.
    const ttIssues = timetables.map(timetableIssue).filter((x): x is string => x !== null);
    for (const r of resources) {
      if (r.name.trim() && r.timetableId === SHIFTS_ID && r.shifts.length === 0) {
        ttIssues.push(`El recurso "${r.name.trim()}" está en «Turnos» pero no tiene ninguno; se simuló con 1 persona 24/7.`);
      }
    }

    const requested = Math.floor(Number(instances));
    if (!Number.isFinite(requested) || requested < 1) {
      setRunError("El nº de instancias debe ser un número mayor que 0.");
      return;
    }
    if (requested > INSTANCES_WARN_THRESHOLD
        && !confirm(`Vas a simular ${requested.toLocaleString()} instancias. El navegador puede quedarse sin responder un rato. ¿Continuar?`)) {
      return;
    }

    setRunError(null);
    setRunning(true);
    // Cede un frame para que el botón pinte el estado "Simulando…" antes de
    // bloquear el hilo con el cálculo.
    setTimeout(() => { void executeRun(requested, ttIssues); }, 0);
  }

  function executeRun(requested: number, ttIssues: string[]) {
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
    for (const r of resources) {
      const name = r.name.trim();
      if (!name) continue;
      cfgRes[name] = r.timetableId === SHIFTS_ID
        ? { capacity: Math.max(1, ...r.shifts.map(headcount)), costPerHour: r.costPerHour, shifts: r.shifts }
        : { capacity: r.capacity, costPerHour: r.costPerHour, timetableId: r.timetableId || undefined };
    }
    // Se descartan las demoras nulas por su valor esperado, no por la media: en
    // la uniforme y la triangular la media no se usa y una espera "entre 2 y 4
    // días" se ignoraba sin avisar.
    const cfgDelays: NonNullable<SimConfig["delays"]> = {};
    for (const [id, d] of Object.entries(delays)) {
      const dist = toDistribution(d);
      if (expectedValue(dist) > 0) cfgDelays[id] = dist;
    }
    const cfgBoundaries: NonNullable<SimConfig["boundaries"]> = {};
    for (const [id, d] of Object.entries(boundaries)) {
      const dist = toDistribution(d);
      if (expectedValue(dist) > 0) cfgBoundaries[id] = dist;
    }
    const cfgTimetables: NonNullable<SimConfig["timetables"]> = {};
    for (const tt of timetables) cfgTimetables[tt.id] = tt;

    const config: SimConfig = {
      instances: requested,
      arrival: toDistribution(arrival),
      // Si se borró el horario elegido, las llegadas pasan a ser 24/7.
      arrivalTimetableId: cfgTimetables[arrivalTimetableId] ? arrivalTimetableId : undefined,
      defaultTask: { kind: "exponential", mean: defaultMean },
      transferTime,
      tasks: cfgTasks,
      delays: cfgDelays,
      boundaries: cfgBoundaries,
      gateways: weights,
      resources: cfgRes,
      timetables: cfgTimetables,
      startDateMs: new Date(startDate).getTime() || defaultScenarioStart().getTime(),
      warmupPercent: warmup,
      currency,
      seed: 12345,
    };

    let res: SimResult;
    try {
      res = runSimulation(graph, config);
    } catch (e) {
      // Sin esta captura, cualquier fallo del motor tumbaba todo el árbol de
      // React y el usuario se quedaba con la pantalla en blanco.
      console.error("[simulación]", e);
      setRunError(
        `La simulación falló: ${e instanceof Error ? e.message : String(e)}. ` +
        "Prueba con menos instancias o revisa los datos del escenario.",
      );
      setRunning(false);
      return;
    }

    if (ttIssues.length) res.warnings.unshift(...ttIssues);
    lastConfigRef.current = config;

    setResult(res); setHasRun(true); setSection("results"); setRunning(false);
    // Persiste resumen (IA) y datos estructurados (export Excel) del escenario
    safeSet(summaryKey(scenario, processId), buildResultText(res));
    safeSet(exportKey(scenario, processId), JSON.stringify(buildExportData(res)));
    const anim = animatorRef.current;
    if (anim) { anim.load(res.segments, res.maxTime); anim.setSpeed(speed); anim.play(); }
  }

  // ── Resúmenes de texto para alimentar a la IA ───────────────────────────────
  const nodeName = (id: string) => graph.nodes.get(id)?.name || graph.nodes.get(id)?.bpmnType.replace("bpmn:", "") || id;
  function buildDiagramText(): string {
    const L: string[] = [
      `Proceso "${(processName || "").trim() || "(sin nombre)"}" — escenario ${scenarioLabel}.`,
      `Estructura: ${taskNodes.length} tareas, ${gatewayNodes.length} compuertas de decisión, ${eventNodes.length} eventos, ${boundaryNodes.length} eventos de borde.`,
    ];
    if (taskNodes.length) L.push("Tareas: " + taskNodes.map((n) => `"${n.name || n.id}"`).join(", "));
    if (gatewayNodes.length) L.push("Compuertas (decisiones): " + gatewayNodes.map((g) => `"${g.name || g.id}" (${g.outgoing.length} ramas)`).join(", "));
    if (eventNodes.length) L.push("Eventos/esperas: " + eventNodes.map((e) => `"${e.name || e.id}"`).join(", "));
    if (boundaryNodes.length) L.push("Eventos de borde: " + boundaryNodes.map((b) => `"${b.name || b.id}" en "${b.attachedTo ? nodeName(b.attachedTo) : "?"}"`).join(", "));
    const flows = [...graph.flows.values()];
    if (flows.length) L.push("Secuencia del flujo: " + flows.slice(0, 40).map((f) => `${nodeName(f.source)}→${nodeName(f.target)}${f.name ? ` [${f.name}]` : ""}`).join("; "));
    return L.join("\n");
  }
  function buildResultText(r: SimResult): string {
    const L: string[] = [
      `Resultados de simulación (${scenarioLabel}):`,
      `- Instancias completadas: ${r.completed}/${r.started}`,
      `- Cycle time medio (reloj): ${fmtTime(r.avgCycle)} (mín ${fmtTime(r.minCycle)}, máx ${fmtTime(r.maxCycle)})`,
      `- Cycle time hábil (sin off-horario): ${fmtTime(r.avgCycleExcl)}`,
      `- Tiempo de proceso medio: ${fmtTime(r.avgProcessing)} · espera (cola y demoras): ${fmtTime(r.avgWaiting)} · inactivo fuera de horario: ${fmtTime(r.avgIdle)}`,
      `- Eficiencia (proc/cycle): ${(r.cycleEfficiency * 100).toFixed(1)}% · throughput: ${r.throughputPerHour.toFixed(2)}/h · costo total: ${r.currency} ${r.totalCost.toFixed(2)}`,
      `Por actividad (visitas · proc · espera · inactivo · costo):`,
      ...r.activities.slice(0, 12).map((a) => `  · ${a.name}: ${a.visits} · ${fmtTime(a.visits ? a.totalProcessing / a.visits : 0)} · ${fmtTime(a.visits ? a.totalWaiting / a.visits : 0)} · ${fmtTime(a.visits ? a.totalIdle / a.visits : 0)} · ${r.currency}${a.cost.toFixed(2)}`),
    ];
    // Cuellos de botella explícitos (mayor procesamiento y mayor espera)
    const avgP = (a: SimResult["activities"][number]) => (a.visits ? a.totalProcessing / a.visits : 0);
    const avgW = (a: SimResult["activities"][number]) => (a.visits ? a.totalWaiting / a.visits : 0);
    const topProc = [...r.activities].sort((a, b) => avgP(b) - avgP(a))[0];
    const topWait = [...r.activities].sort((a, b) => avgW(b) - avgW(a))[0];
    if (topProc) L.push(`Actividad más larga: "${topProc.name}" (${fmtTime(avgP(topProc))} de proceso).`);
    if (topWait && avgW(topWait) > 0) L.push(`Mayor espera (posible cuello de botella): "${topWait.name}" (${fmtTime(avgW(topWait))} en cola).`);
    if (r.resources.length) {
      L.push("Recursos (utilización): " + r.resources.map((rs) => `${rs.name} ${(rs.utilization * 100).toFixed(0)}%${rs.variableCapacity ? " (por turnos)" : ""}`).join(", "));
      const over = r.resources.filter((rs) => rs.utilization > 0.85);
      if (over.length) L.push("Recursos saturados (>85%): " + over.map((rs) => rs.name).join(", "));
    }
    return L.join("\n");
  }

  // ── Exportación a Excel (AS-IS / TO-BE) ─────────────────────────────────────
  function buildExportData(res: SimResult): SimExportData {
    const name = (processName || "").trim() || "Proceso";
    return {
      scenarioLabel, name, currency: res.currency,
      completed: res.completed, started: res.started,
      avgCycle: res.avgCycle, minCycle: res.minCycle, maxCycle: res.maxCycle, avgCycleExcl: res.avgCycleExcl,
      avgProcessing: res.avgProcessing, avgWaiting: res.avgWaiting, avgIdle: res.avgIdle, avgTransfer: res.avgTransfer,
      cycleEfficiency: res.cycleEfficiency, throughputPerHour: res.throughputPerHour, totalCost: res.totalCost,
      activities: res.activities.map((a) => ({
        name: a.name, visits: a.visits,
        proc: a.visits ? a.totalProcessing / a.visits : 0,
        wait: a.visits ? a.totalWaiting / a.visits : 0,
        idle: a.visits ? a.totalIdle / a.visits : 0,
        cost: a.cost, durOver: a.durOverThreshold, costOver: a.costOverThreshold,
      })),
      resources: res.resources.map((rs) => ({ name: rs.name, capacity: rs.capacity, utilization: rs.utilization, cost: rs.cost })),
    };
  }
  const fileSafe = (s: string) => s.replace(/[^\w-]+/g, "_").slice(0, 40) || "proceso";

  function readExport(sc: "asis" | "tobe"): SimExportData | null {
    try {
      const raw = safeGet(exportKey(sc, processId));
      return raw ? (JSON.parse(raw) as SimExportData) : null;
    } catch {
      return null;
    }
  }

  function exportCurrent() {
    if (!result) return;
    const d = buildExportData(result);
    downloadXls(`Simulacion_${fileSafe(d.name)}_${scenario ?? "escenario"}`, [stackedSheet(d.scenarioLabel, d)]);
  }

  function exportBoth() {
    if (!result) return;
    const cur = buildExportData(result);
    safeSet(exportKey(scenario, processId), JSON.stringify(cur));
    const otherScenario = scenario === "asis" ? "tobe" : "asis";
    const other = readExport(otherScenario);
    if (!other) {
      alert(`Primero ejecuta la simulación del ${otherScenario === "asis" ? "AS-IS" : "TO-BE"} (en la otra pestaña) para exportar ambos escenarios.`);
      return;
    }
    const asis = scenario === "asis" ? cur : other;
    const tobe = scenario === "asis" ? other : cur;
    downloadXls(`Simulacion_${fileSafe(cur.name)}_ASIS-vs-TOBE`, [comparisonSheet(asis, tobe), stackedSheet("AS-IS", asis), stackedSheet("TO-BE", tobe)]);
  }

  // ── Análisis calculado (base del asistente) ─────────────────────────────────
  /** Diagnóstico de la última corrida. Se cachea porque re-simula varias veces. */
  function currentAnalysis(): ScenarioAnalysis | null {
    const cfg = lastConfigRef.current;
    if (!result || !cfg) return null;
    if (analysisRef.current?.result === result) return analysisRef.current.analysis;
    const analysis = analyzeScenario({ graph, config: cfg, result, processName, scenarioLabel });
    analysisRef.current = { result, analysis };
    return analysis;
  }

  /** Datos estructurados de ambos escenarios, para el veredicto calculado. */
  function scenarioPair(): { asis: ScenarioData; tobe: ScenarioData } | null {
    const mine = result ? buildExportData(result) : readExport(scenario === "tobe" ? "tobe" : "asis");
    const other = readExport(scenario === "asis" ? "tobe" : "asis");
    if (!mine || !other) return null;
    return scenario === "asis" ? { asis: mine, tobe: other } : { asis: other, tobe: mine };
  }

  /**
   * Consulta al asistente con las cifras calculadas por delante.
   *
   * `computed` produce el análisis del propio simulador: viaja en el contexto
   * para que el modelo cite números reales, y es lo que se muestra cuando no hay
   * modelo de lenguaje (modo demo) o este falla. Antes, sin API key, la pestaña
   * IA solo devolvía un texto genérico pidiendo configurar una clave.
   */
  async function askAi(aiTitleText: string, query: string, opts: AskOptions = {}) {
    setSection("ia"); setAiBusy(true); setAiError(null); setAiNotice(null);
    setAiTitle(aiTitleText); setAiAnswer(null); setAiSource(null); setAiComputed(null);
    // Cede un frame para pintar "Consultando…": el análisis re-simula y bloquea.
    await new Promise((r) => setTimeout(r, 0));

    let calculated: string | null = null;
    try {
      calculated = opts.computed?.() ?? null;
    } catch (e) {
      console.error("[análisis]", e);
    }

    const show = (md: string, source: AiSource) => {
      setAiAnswer(md); setAiSource(source);
      if (opts.saveTo) safeSet(opts.saveTo, JSON.stringify({ md, source }));
    };
    const fallback = (notice?: string) => {
      if (calculated) {
        show(calculated, "calculado");
        if (notice) setAiNotice(`${notice} Se muestra el análisis calculado.`);
      } else {
        setAiError(notice ?? "No hay un modelo de lenguaje configurado. Ejecuta la simulación y aquí verás el análisis calculado con tus datos.");
      }
    };

    // Las cifras calculadas van PRIMERO: si hay que recortar el contexto se
    // pierde el detalle del diagrama, no los números que el asistente debe citar.
    const parts: string[] = [];
    if (calculated) parts.push(`=== ANÁLISIS CALCULADO POR EL SIMULADOR (fuente de verdad de las cifras) ===\n${calculated}`);
    parts.push(buildDiagramText());
    if (opts.includeResult && result) parts.push(buildResultText(result));
    if (opts.extra) parts.push(opts.extra);

    try {
      const res = await expertAsk({ query, role: AI_ROLE, context: clampContext(parts.join("\n\n")) });
      if (!res.success) fallback(`El asistente no respondió (${res.error ?? "sin detalle"}).`);
      else if (res.provider === MOCK_PROVIDER) fallback();
      else { show(res.answer, "llm"); setAiComputed(calculated); }
    } catch (e) {
      fallback(`No se pudo contactar con el asistente (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setAiBusy(false);
    }
  }

  // Diagnóstico completo del AS-IS + propuesta de cómo debería ser el TO-BE
  function askDiagnose() {
    void askAi(
      "Diagnóstico del AS-IS y diseño del TO-BE",
      "Actúa como consultor de procesos. Con el diagrama y los resultados del AS-IS, entrega tu análisis EXACTAMENTE en estas secciones:\n" +
      "1) **Diagnóstico** — qué funciona mal hoy, con números.\n" +
      "2) **Cuellos de botella** — qué actividad limita el proceso y por qué.\n" +
      "3) **Desperdicios (mudas)** — esperas, retrabajos, sobre-costos, sobre-procesamiento.\n" +
      "4) **Qué mejorar y cómo** — acciones concretas.\n" +
      "5) **Diseño del TO-BE propuesto** — cambios específicos al flujo: automatizar, eliminar, fusionar o paralelizar pasos, redistribuir recursos, ajustar políticas/horarios.\n" +
      "6) **Impacto esperado** — usa el impacto re-simulado del análisis calculado.\n" +
      "Usa esos títulos con viñetas y cita números del proceso.",
      {
        includeResult: true,
        computed: () => { const a = currentAnalysis(); return a ? renderDiagnosis(a) : null; },
        // En el AS-IS se guarda: es la propuesta a seguir al diseñar el TO-BE.
        saveTo: scenario === "asis" ? proposalKey(processId) : undefined,
      },
    );
  }

  function showAsisProposal() {
    setSection("ia"); setAiBusy(false); setAiNotice(null); setAiComputed(null);
    setAiTitle("Propuesta de TO-BE que salió del AS-IS");
    let stored: { md: string; source: AiSource } | null = null;
    try {
      const raw = safeGet(proposalKey(processId));
      if (raw) stored = JSON.parse(raw) as { md: string; source: AiSource };
    } catch { /* guardado corrupto: se trata como ausente */ }
    if (stored?.md) {
      setAiError(null); setAiAnswer(stored.md); setAiSource(stored.source);
    } else {
      setAiAnswer(null); setAiSource(null);
      setAiError("Todavía no hay propuesta. En la pestaña AS-IS, ejecuta la simulación y pulsa «Diagnosticar AS-IS y diseñar el TO-BE».");
    }
  }

  function gatherBoth(): { asis: string; tobe: string } | null {
    const me = result ? buildResultText(result) : safeGet(summaryKey(scenario, processId));
    const other = safeGet(summaryKey(scenario === "asis" ? "tobe" : "asis", processId));
    if (!me || !other) return null;
    return { asis: scenario === "asis" ? me : other, tobe: scenario === "asis" ? other : me };
  }
  function needBothError(): boolean {
    if (gatherBoth()) return false;
    const falta = scenario === "asis" ? "TO-BE" : "AS-IS";
    setSection("ia"); setAiAnswer(null); setAiSource(null);
    setAiError(`Para comparar necesito AMBAS simulaciones. Ejecuta también el ${falta} (en la otra pestaña) y vuelve.`);
    return true;
  }

  const verdictComputed = () => {
    const pair = scenarioPair();
    return pair ? renderVerdict(compareScenarios(pair.asis, pair.tobe)) : null;
  };

  function askCompare() {
    if (needBothError()) return;
    const both = gatherBoth()!;
    void askAi(
      "Comparar AS-IS vs TO-BE",
      "Compara los resultados de la simulación AS-IS contra el TO-BE: cuantifica las diferencias (cycle time, espera, costo, eficiencia, throughput, utilización) con el % de mejora de cada métrica, y di qué mejoró y qué empeoró. Usa una tabla si ayuda.",
      { extra: `=== RESULTADOS AS-IS ===\n${both.asis}\n\n=== RESULTADOS TO-BE ===\n${both.tobe}`, computed: verdictComputed },
    );
  }

  // Veredicto final: la IA decide si el TO-BE vale la pena
  function askVerdict() {
    if (needBothError()) return;
    const both = gatherBoth()!;
    void askAi(
      "Veredicto final: AS-IS vs TO-BE",
      "Eres el consultor que toma la decisión. Con AMBOS resultados, entrega tu veredicto EXACTAMENTE en estas secciones:\n" +
      "1) **Comparación cuantitativa** — cycle time, espera, costo, eficiencia, throughput y utilización, con el % de mejora de cada uno.\n" +
      "2) **Qué mejoró y por qué** — vincúlalo a los cambios del TO-BE.\n" +
      "3) **Riesgos / trade-offs** del TO-BE.\n" +
      "4) **VEREDICTO FINAL** — ¿se implementa el TO-BE? ¿qué ajustar antes? Sé tajante y justifícalo con los números.",
      { extra: `=== RESULTADOS AS-IS ===\n${both.asis}\n\n=== RESULTADOS TO-BE ===\n${both.tobe}`, computed: verdictComputed },
    );
  }

  function addResource() {
    setResources((r) => [...r, { name: `Recurso ${r.length + 1}`, capacity: 1, costPerHour: 20, timetableId: "default", shifts: [] }]);
  }
  function addTimetable() {
    setTimetables((t) => [...t, { id: `tt_${Date.now()}`, name: `Horario ${t.length + 1}`, beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020 }]);
  }
  function patchResource(i: number, patch: Partial<ResourceRow>) {
    setResources((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  const resourceNames = resources.map((r) => r.name.trim()).filter(Boolean);
  const selected = selectedId ? graph.nodes.get(selectedId) ?? null : null;

  // Los editores del elemento seleccionado viven a nivel de modulo (ver arriba):
  // definidos aqui dentro, React los trataba como un tipo de componente nuevo en
  // cada render y desmontaba/remontaba los inputs, con lo que el campo perdia el
  // foco a cada tecla -- y durante la animacion, 60 veces por segundo.

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

      <button className="sim-run-btn" onClick={run} disabled={running}>
        {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
        {running ? " Simulando…" : hasRun ? " Volver a ejecutar" : " Ejecutar simulación"}
      </button>
      {runError && <div className="sim-warn" role="alert">⚠ {runError}</div>}

      <div className="sim-tabs">
        <button className={section === "config" ? "active" : ""} onClick={() => setSection("config")}>Configuración</button>
        <button className={section === "results" ? "active" : ""} onClick={() => setSection("results")} disabled={!result}>Resultados</button>
        <button className={`sim-tab-ia ${section === "ia" ? "active" : ""}`} onClick={() => setSection("ia")}><Sparkles size={12} /> IA</button>
      </div>

      <div className="sim-scroll">
        {section === "config" && (
          <>
            {selected ? (
              <SelectedEditor
                node={selected}
                taskCfg={tasks[selected.id]}
                resourceNames={resourceNames}
                onPatchTask={(patch) => setTasks((t) => {
                  const cur = t[selected.id];
                  return cur ? { ...t, [selected.id]: { ...cur, ...patch } } : t;
                })}
                gatewayWeights={weights[selected.id] ?? {}}
                flowLabel={flowLabel}
                onWeight={(flowId, value) => setWeights((w) => ({
                  ...w, [selected.id]: { ...w[selected.id], [flowId]: value },
                }))}
                delay={delays[selected.id] ?? newDist(0, "minutes", "fixed")}
                onDelay={(d) => setDelays((x) => ({ ...x, [selected.id]: d }))}
                boundary={boundaries[selected.id] ?? newDist(0, "minutes", "fixed")}
                onBoundary={(d) => setBoundaries((x) => ({ ...x, [selected.id]: d }))}
                hostName={(selected.attachedTo ? graph.nodes.get(selected.attachedTo)?.name : "") || "la actividad"}
                onClose={() => setSelectedId(null)}
              />
            ) : (
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
              <label className="sim-field" style={{ marginTop: 8 }}>Horario de llegadas
                <select value={arrivalTimetableId} onChange={(e) => setArrivalTimetableId(e.target.value)}>
                  {timetables.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
                </select>
              </label>
              <p className="sim-hint-mini">Las solicitudes solo se crean dentro de este horario y el tiempo entre llegadas cuenta en horas de ese horario. Elige 24/7 si también llegan de noche.</p>
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
              {resources.map((r, i) => {
                const byShifts = r.timetableId === SHIFTS_ID;
                return (
                  <div key={i} className="sim-res-block">
                    <div className="sim-res-row">
                      <input className="sim-res-name" value={r.name} onChange={(e) => patchResource(i, { name: e.target.value })} />
                      <input
                        type="number" min={1}
                        title={byShifts ? "Con turnos, las personas se indican en cada turno" : "capacidad"}
                        value={byShifts ? Math.max(0, ...r.shifts.map(headcount)) : r.capacity}
                        disabled={byShifts}
                        onChange={(e) => patchResource(i, { capacity: Number(e.target.value) })}
                      />
                      <input type="number" min={0} title="costo/hora" value={r.costPerHour} onChange={(e) => patchResource(i, { costPerHour: Number(e.target.value) })} />
                      <select title="horario laboral" value={r.timetableId} onChange={(e) => {
                        const id = e.target.value;
                        patchResource(i, id === SHIFTS_ID && r.shifts.length === 0
                          ? { timetableId: id, shifts: threeShifts(r.capacity) }
                          : { timetableId: id });
                      }}>
                        {timetables.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
                        <option value={SHIFTS_ID}>Turnos (dotación variable)</option>
                      </select>
                      <button className="sim-icon-btn" onClick={() => setResources((rs) => rs.filter((_, j) => j !== i))}><X size={13} /></button>
                    </div>
                    {byShifts && <ShiftsEditor shifts={r.shifts} onChange={(shifts) => patchResource(i, { shifts })} />}
                  </div>
                );
              })}
              <button className="sim-add" onClick={addResource}>+ Añadir recurso</button>
            </section>

            {/* Timetables */}
            <section className="sim-sec">
              <h4><CalendarDays size={13} /> Horarios de trabajo</h4>
              <p className="sim-empty" style={{ marginBottom: 6 }}>Las tareas con recurso sólo avanzan en su horario; el cycle time incluye noches/fines de semana. Para trabajo por turnos (24/7, turno de noche o distinta gente en cada turno) elige «Turnos» en el recurso.</p>
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
            expertLabel={scenario === "tobe" ? "Veredicto IA (AS-IS vs TO-BE)" : "Diagnóstico experto IA"}
            onInterpret={() => (scenario === "tobe" ? askVerdict() : askDiagnose())}
            onExport={exportCurrent}
            onExportBoth={exportBoth}
          />
        )}

        {section === "ia" && (
          <div className="sim-ia">
            <div className="sim-ia-intro">
              <Brain size={16} />
              <p>
                Consultor de procesos para <b>{scenarioLabel}</b>. Entiende el diagrama y los resultados para
                {scenario === "tobe"
                  ? <> dar el <b>veredicto final</b> AS-IS vs TO-BE.</>
                  : <> <b>diagnosticar</b> el AS-IS y proponer cómo debería ser el <b>TO-BE</b>.</>}
              </p>
            </div>
            <div className="sim-ia-actions">
              {/* Acción principal según el escenario */}
              {scenario === "tobe" ? (
                <>
                  <button className="sim-ia-btn sim-ia-btn-primary" disabled={aiBusy} onClick={askVerdict}>
                    <Scale size={15} /> Veredicto final (AS-IS vs TO-BE)
                  </button>
                  <button className="sim-ia-btn" disabled={aiBusy} onClick={showAsisProposal}>
                    <ClipboardList size={14} /> Propuesta que salió del AS-IS
                  </button>
                </>
              ) : (
                <button className="sim-ia-btn sim-ia-btn-primary" disabled={aiBusy || !result} onClick={askDiagnose}>
                  <Stethoscope size={15} /> Diagnosticar AS-IS y diseñar el TO-BE {result ? "" : "(ejecuta primero)"}
                </button>
              )}

              {/* Acciones de apoyo */}
              <button className="sim-ia-btn" disabled={aiBusy} onClick={() => void askAi(
                "Ayuda para llenar los datos",
                "Explícame en términos simples qué significa cada dato que debo llenar para simular ESTE diagrama (llegadas, horario de llegadas, distribución, duración por tarea, recursos, turnos, compuertas, eventos de borde, horarios). Luego sugiéreme valores razonables para cada tarea, compuerta y evento según sus nombres. Sé concreto y por elemento.",
                { computed: () => renderDataGuide(graph) },
              )}>
                <Wand2 size={14} /> Ayúdame a llenar los datos
              </button>
              <button className="sim-ia-btn" disabled={aiBusy || !result} onClick={() => void askAi(
                "Interpretación de resultados",
                `Interpreta los resultados de la simulación de ${scenarioLabel}. Identifica cuellos de botella, esperas, tiempo fuera de horario, sobrecostos y baja eficiencia con base en los números, y di concretamente QUÉ mejorar y por qué.`,
                { includeResult: true, computed: () => { const a = currentAnalysis(); return a ? renderDiagnosis(a) : null; } },
              )}>
                <Lightbulb size={14} /> Interpretar resultados {result ? "" : "(ejecuta primero)"}
              </button>
              <button className="sim-ia-btn" disabled={aiBusy} onClick={() => void askAi(
                "Metodología de mejora",
                "Con base en este proceso y sus resultados (si los hay), recomiéndame qué metodología/herramienta de mejora usar: Lean (¿qué mudas?), Six Sigma/DMAIC, Teoría de Restricciones, BPR/rediseño o automatización RPA. Di cuál priorizar, por qué, y los próximos pasos concretos.",
                { includeResult: true, computed: () => { const a = currentAnalysis(); return a ? renderMethodology(a) : null; } },
              )}>
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
                {aiSource === "calculado" && (
                  <p className="sim-ia-source">
                    <Calculator size={12} />
                    <span>Calculado por el simulador con tus datos: cada mejora se mide re-simulando el escenario. Sin modelo de lenguaje configurado; con una API key, el asistente lo redacta usando estas mismas cifras.</span>
                  </p>
                )}
                {aiNotice && <div className="sim-warn">⚠ {aiNotice}</div>}
                <ChatMarkdown content={aiAnswer} />
                {aiSource === "llm" && aiComputed && (
                  <details className="sim-ia-computed">
                    <summary>Cifras calculadas por el simulador</summary>
                    <ChatMarkdown content={aiComputed} />
                  </details>
                )}
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

function ResultsView({ result, onInterpret, onExport, onExportBoth, expertLabel }: { result: SimResult; onInterpret: () => void; onExport: () => void; onExportBoth: () => void; expertLabel: string }) {
  const cur = result.currency;
  const kpis: Array<[string, string]> = [
    ["Cycle time (reloj)", fmtTime(result.avgCycle)],
    ["Cycle time hábil", fmtTime(result.avgCycleExcl)],
    ["Cycle min / máx", `${fmtTime(result.minCycle)} / ${fmtTime(result.maxCycle)}`],
    ["Tiempo de proceso", fmtTime(result.avgProcessing)],
    ["Espera (cola + demoras)", fmtTime(result.avgWaiting)],
    ["Fuera de horario", fmtTime(result.avgIdle)],
    ["Eficiencia", `${(result.cycleEfficiency * 100).toFixed(1)} %`],
    ["Throughput", `${result.throughputPerHour.toFixed(2)} /h`],
    ["Costo total", `${cur} ${result.totalCost.toFixed(2)}`],
    ["Completados", `${result.completed} / ${result.started}`],
  ];
  return (
    <div className="sim-results">
      <div className="sim-results-toolbar">
        <button className="sim-ia-inline-btn" onClick={onInterpret}><Sparkles size={13} /> {expertLabel}</button>
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
        <thead><tr><th>Actividad</th><th>Visitas</th><th>Proc.</th><th title="cola del recurso o demora del evento">Espera</th><th title="parada fuera de horario">Inact.</th><th>Costo</th><th title="excesos de duración / costo sobre umbral">{'>'}umbral</th></tr></thead>
        <tbody>
          {result.activities.map((a) => (
            <tr key={a.id}>
              <td title={a.name}>{a.name}</td>
              <td>{a.visits}</td>
              <td>{fmtTime(a.visits ? a.totalProcessing / a.visits : 0)}</td>
              <td>{fmtTime(a.visits ? a.totalWaiting / a.visits : 0)}</td>
              <td>{fmtTime(a.visits ? a.totalIdle / a.visits : 0)}</td>
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
            <thead><tr><th>Recurso</th><th title="personas; con turnos, las del turno más numeroso">Cap.</th><th>Utilización</th><th>Costo</th></tr></thead>
            <tbody>
              {result.resources.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td><td title={r.variableCapacity ? "trabaja por turnos" : undefined}>{r.variableCapacity ? `≤${r.capacity}` : r.capacity}</td>
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
