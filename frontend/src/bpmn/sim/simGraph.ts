// ── Extrae un grafo de simulación desde el modelo vivo de bpmn-js ────────────
// Clasifica cada elemento BPMN y conserva los waypoints reales de cada flujo
// (para animar los tokens recorriendo las líneas tal cual están dibujadas).

export type NodeKind =
  | "start"
  | "end"
  | "task"
  | "xor" // exclusive / event-based gateway
  | "and" // parallel gateway
  | "or" // inclusive gateway
  | "event" // intermediate catch/throw
  | "boundary" // evento pegado al borde de una actividad
  | "passthrough"; // cualquier otro

/** Tipo de disparador de un evento (símbolo interno). */
export type EventTrigger =
  | "none"
  | "timer"
  | "message"
  | "error"
  | "escalation"
  | "signal"
  | "conditional";

export interface Point {
  x: number;
  y: number;
}

export interface SimNode {
  id: string;
  name: string;
  kind: NodeKind;
  bpmnType: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  incoming: string[]; // flow ids
  outgoing: string[]; // flow ids
  /** Sólo boundary: id de la actividad a la que está pegado. */
  attachedTo?: string;
  /** Sólo boundary: true = interrumpe la actividad (cancelActivity). */
  interrupting?: boolean;
  /** Disparador del evento (símbolo): timer/message/error/… */
  trigger?: EventTrigger;
}

export interface SimFlow {
  id: string;
  name: string;
  source: string;
  target: string;
  waypoints: Point[];
  length: number; // longitud total de la polilínea (px)
}

export interface SimGraph {
  nodes: Map<string, SimNode>;
  flows: Map<string, SimFlow>;
  starts: string[];
  /** taskId → ids de eventos de borde pegados a esa actividad. */
  boundaries: Map<string, string[]>;
}

interface RegistryElement {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  waypoints?: Point[];
  businessObject?: {
    name?: string;
    sourceRef?: { id: string };
    targetRef?: { id: string };
    attachedToRef?: { id: string };
    cancelActivity?: boolean;
    eventDefinitions?: Array<{ $type?: string }>;
  };
}

interface ElementRegistry {
  getAll: () => RegistryElement[];
}

function classify(bpmnType: string): NodeKind {
  const t = bpmnType.replace("bpmn:", "");
  if (t === "StartEvent") return "start";
  if (t === "EndEvent") return "end";
  if (t === "BoundaryEvent") return "boundary";
  if (t === "ExclusiveGateway" || t === "EventBasedGateway") return "xor";
  if (t === "ParallelGateway") return "and";
  if (t === "InclusiveGateway" || t === "ComplexGateway") return "or";
  if (t.endsWith("Task") || t === "SubProcess" || t === "CallActivity") return "task";
  if (t.includes("Event")) return "event";
  return "passthrough";
}

/** Deriva el disparador del evento desde su eventDefinition. */
function triggerOf(defs?: Array<{ $type?: string }>): EventTrigger {
  const ty = defs?.[0]?.$type?.replace("bpmn:", "") ?? "";
  if (ty.startsWith("Timer")) return "timer";
  if (ty.startsWith("Message")) return "message";
  if (ty.startsWith("Error")) return "error";
  if (ty.startsWith("Escalation")) return "escalation";
  if (ty.startsWith("Signal")) return "signal";
  if (ty.startsWith("Conditional")) return "conditional";
  return "none";
}

function polylineLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

export function buildSimGraph(elementRegistry: ElementRegistry): SimGraph {
  const all = elementRegistry.getAll();
  const nodes = new Map<string, SimNode>();
  const flows = new Map<string, SimFlow>();

  // 1) nodos (shapes)
  for (const el of all) {
    if (el.type === "bpmn:SequenceFlow") continue;
    if (el.type === "label" || el.type === "bpmn:Process") continue;
    if (typeof el.x !== "number" || typeof el.y !== "number") continue;
    const kind = classify(el.type);
    if (kind === "passthrough" && (el.type === "bpmn:Lane" || el.type === "bpmn:Participant")) {
      continue; // pools/lanes no son nodos de flujo
    }
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    const bo = el.businessObject;
    nodes.set(el.id, {
      id: el.id,
      name: bo?.name?.trim() || "",
      kind,
      bpmnType: el.type,
      cx: el.x + w / 2,
      cy: el.y + h / 2,
      width: w,
      height: h,
      incoming: [],
      outgoing: [],
      attachedTo: kind === "boundary" ? bo?.attachedToRef?.id : undefined,
      // En BPMN, cancelActivity ausente = true (interrumpe). Sólo false = no interrumpe.
      interrupting: kind === "boundary" ? bo?.cancelActivity !== false : undefined,
      trigger: kind === "boundary" || kind === "event" ? triggerOf(bo?.eventDefinitions) : undefined,
    });
  }

  // 2) flujos (connections) + waypoints
  for (const el of all) {
    if (el.type !== "bpmn:SequenceFlow") continue;
    const s = el.businessObject?.sourceRef?.id;
    const t = el.businessObject?.targetRef?.id;
    if (!s || !t) continue;
    const wps = (el.waypoints ?? []).map((p) => ({ x: p.x, y: p.y }));
    // fallback: centro→centro si faltan waypoints
    const pts =
      wps.length >= 2
        ? wps
        : [
            nodes.get(s) ? { x: nodes.get(s)!.cx, y: nodes.get(s)!.cy } : { x: 0, y: 0 },
            nodes.get(t) ? { x: nodes.get(t)!.cx, y: nodes.get(t)!.cy } : { x: 0, y: 0 },
          ];
    flows.set(el.id, {
      id: el.id,
      name: el.businessObject?.name?.trim() || "",
      source: s,
      target: t,
      waypoints: pts,
      length: polylineLength(pts),
    });
    nodes.get(s)?.outgoing.push(el.id);
    nodes.get(t)?.incoming.push(el.id);
  }

  // 3) mapa de boundaries por actividad anfitriona
  const boundaries = new Map<string, string[]>();
  for (const n of nodes.values()) {
    if (n.kind === "boundary" && n.attachedTo) {
      const list = boundaries.get(n.attachedTo) ?? [];
      list.push(n.id);
      boundaries.set(n.attachedTo, list);
    }
  }

  // 4) starts (StartEvent, o nodos sin entrada como respaldo).
  //    Los boundary NO cuentan como inicio aunque no tengan entrada.
  let starts = [...nodes.values()].filter((n) => n.kind === "start").map((n) => n.id);
  if (starts.length === 0) {
    starts = [...nodes.values()]
      .filter((n) => n.incoming.length === 0 && n.kind !== "end" && n.kind !== "boundary")
      .map((n) => n.id);
  }

  return { nodes, flows, starts, boundaries };
}

/** Punto a lo largo de la polilínea en fracción [0,1] (para animar el token). */
export function pointAlong(flow: SimFlow, frac: number): Point {
  const pts = flow.waypoints;
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  const target = Math.max(0, Math.min(1, frac)) * flow.length;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= target || i === pts.length - 1) {
      const local = seg > 0 ? (target - acc) / seg : 0;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * local,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * local,
      };
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}
