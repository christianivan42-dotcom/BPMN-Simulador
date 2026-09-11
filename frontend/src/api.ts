// ─────────────────────────────────────────────────────────────────────────────
// Cliente HTTP del backend.
//
// Este fichero llegó a tener 2.514 líneas y 91 funciones exportadas, de las que
// solo 9 se usaban: el resto apuntaba a endpoints retirados del backend (/chat,
// /knowledge, /local-llm, /tasks y ~38 sub-rutas de /process-cases) y devolvía
// 404. Se dejó únicamente lo que la aplicación llama de verdad, para que lo que
// aparece aquí sea exactamente lo que el backend expone.
// ─────────────────────────────────────────────────────────────────────────────

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8010").trim();
const API_V1 = `${apiBaseUrl}/api/v1`;

/** Tope de espera para las consultas al asistente.
 *  El backend encadena hasta 3 proveedores con 60 s de timeout cada uno, así que
 *  sin este tope el usuario podía quedarse mirando el spinner varios minutos. */
const AI_TIMEOUT_MS = 120_000;
/** Tope para el resto de llamadas, que son consultas rápidas a la base local. */
const DEFAULT_TIMEOUT_MS = 30_000;

// ── Infraestructura de peticiones ────────────────────────────────────────────

class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** fetch con AbortController: nunca deja una petición colgada para siempre. */
async function request(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_V1}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        `El backend tardó más de ${Math.round(timeoutMs / 1000)} s en responder.`,
      );
    }
    throw new ApiError(`No se pudo contactar con el backend. ¿Está corriendo en ${apiBaseUrl}?`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // El backend responde Problem Details (RFC 7807): se aprovecha el `detail`
    // en vez de propagar un escueto "failed: 422".
    let detail = "";
    try {
      const body = (await response.clone().json()) as { detail?: string };
      if (body?.detail) detail = ` — ${body.detail}`;
    } catch {
      /* la respuesta no era JSON */
    }
    throw new ApiError(`El backend devolvió un error ${response.status}${detail}`, response.status);
  }
  return response;
}

const json = <T>(init: RequestInit, body: unknown): RequestInit => ({
  ...init,
  headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  body: JSON.stringify(body),
});

// ─────────────────────────────────────────────────────────────────────────────
// Empresa
// ─────────────────────────────────────────────────────────────────────────────

export type PorterActivity = {
  id: string;
  nombre: string;
  descripcion: string;
  procesos: string[];
};

export type PorterChain = {
  actividades_primarias: PorterActivity[];
  actividades_apoyo: PorterActivity[];
  margen: string;
};

export type Kpi = {
  id: string;
  nombre: string;
  meta: string;
  unidad: string;
  frecuencia: string;
  responsable: string;
};

export type PoaItem = {
  id: string;
  objetivo: string;
  actividad: string;
  responsable: string;
  periodo: string;
  indicador: string;
  meta: string;
  presupuesto: string;
};

export type ProcessMapCategory = "estrategico" | "operativo" | "apoyo";

export type ProcessMapItem = {
  id: string;
  nombre: string;
  descripcion: string;
  categoria: ProcessMapCategory;
};

export type Company = {
  id: string;
  razon_social: string;
  nombre_corto: string | null;
  sector: string | null;
  tamano: string | null;
  mision: string | null;
  vision: string | null;
  valores: string | null;
  objetivos_estrategicos: string[];
  estrategias: string[];
  kpis: Kpi[];
  poa: PoaItem[];
  mapa_procesos: ProcessMapItem[];
  planificacion_estrategica: string | null;
  cadena_valor: PorterChain;
  created_at: string;
  updated_at: string;
};

export type CompanyCreate = {
  razon_social: string;
  nombre_corto?: string;
  sector?: string;
  tamano?: string;
  mision?: string;
  vision?: string;
  valores?: string;
  objetivos_estrategicos?: string[];
  estrategias?: string[];
  kpis?: Kpi[];
  poa?: PoaItem[];
  mapa_procesos?: ProcessMapItem[];
  planificacion_estrategica?: string;
};

export type CompanyUpdate = Partial<CompanyCreate> & {
  cadena_valor?: PorterChain;
};

export async function getFirstCompany(): Promise<Company | null> {
  const r = await request("/companies/primera");
  const text = await r.text();
  return !text || text === "null" ? null : (JSON.parse(text) as Company);
}

export async function createCompany(payload: CompanyCreate): Promise<Company> {
  const r = await request("/companies", json({ method: "POST" }, payload));
  return r.json() as Promise<Company>;
}

export async function updateCompany(id: string, payload: CompanyUpdate): Promise<Company> {
  const r = await request(`/companies/${id}`, json({ method: "PATCH" }, payload));
  return r.json() as Promise<Company>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Salud del sistema
// ─────────────────────────────────────────────────────────────────────────────

export type ComponentHealth = { status: "ok" | "degraded" | "error"; detail: string | null };

export type HealthResponse = {
  status: string;
  service: string;
  version: string;
  environment: string;
  database: ComponentHealth;
  llm: ComponentHealth;
  mock_mode: boolean;
  cognitive_agents: ComponentHealth;
};

export async function getHealth(): Promise<HealthResponse> {
  const r = await request("/health");
  return r.json() as Promise<HealthResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Casos de proceso (mapa jerárquico)
// ─────────────────────────────────────────────────────────────────────────────

export type ProcessType =
  | "proceso"
  | "subproceso"
  | "procedimiento"
  | "instructivo"
  | "registro"
  | "politica"
  | "indicador";

export type MapStatus =
  | "identificado"
  | "documentado"
  | "analizado"
  | "optimizado"
  | "sin_tobe";

export type AnalysisStatus =
  | "pendiente"
  | "descompuesto"
  | "en_analisis"
  | "analizado_completo"
  | "agregado"
  | "bloqueado";

export type Staleness =
  | "ok"
  | "hijos_modificados"
  | "propio_modificado"
  | "metricas_obsoletas";

export type ProcessCase = {
  id: string;
  name: string;
  area: string | null;
  objective: string | null;
  scope: string | null;
  owner: string | null;
  status: string;
  process_type: ProcessType | null;
  level: number | null;
  parent_id: string | null;
  map_status: MapStatus;
  analysis_status: AnalysisStatus;
  staleness: Staleness;
  staleness_reason: string | null;
  staleness_since: string | null;
  last_analyzed_at: string | null;
  transversal: boolean;
  related_macro_ids: string[];
  created_at: string;
  updated_at: string;
};

export async function listProcessCases(): Promise<ProcessCase[]> {
  const r = await request("/process-cases");
  return r.json() as Promise<ProcessCase[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagramas BPMN (persistencia en el backend)
// ─────────────────────────────────────────────────────────────────────────────

export type BpmnDiagramSummary = {
  id: string;
  company_id: string;
  name: string;
  map_item_id: string | null;
  position: number;
  has_asis: boolean;
  has_tobe: boolean;
  updated_at: string;
};

export type BpmnDiagram = BpmnDiagramSummary & {
  asis_xml: string | null;
  tobe_xml: string | null;
  sim_config: string | null;
};

export type BpmnDiagramCreate = {
  company_id: string;
  name?: string;
  map_item_id?: string | null;
  asis_xml?: string | null;
  tobe_xml?: string | null;
  sim_config?: string | null;
  position?: number;
};

export type BpmnDiagramUpdate = {
  name?: string;
  map_item_id?: string | null;
  asis_xml?: string;
  tobe_xml?: string;
  sim_config?: string;
  position?: number;
};

export async function listBpmnDiagrams(companyId: string): Promise<BpmnDiagramSummary[]> {
  const r = await request(`/bpmn-diagrams?company_id=${encodeURIComponent(companyId)}`);
  return r.json() as Promise<BpmnDiagramSummary[]>;
}

export async function getBpmnDiagram(id: string): Promise<BpmnDiagram> {
  const r = await request(`/bpmn-diagrams/${id}`);
  return r.json() as Promise<BpmnDiagram>;
}

export async function createBpmnDiagram(payload: BpmnDiagramCreate): Promise<BpmnDiagram> {
  const r = await request("/bpmn-diagrams", json({ method: "POST" }, payload));
  return r.json() as Promise<BpmnDiagram>;
}

export async function updateBpmnDiagram(
  id: string,
  payload: BpmnDiagramUpdate,
): Promise<BpmnDiagram> {
  const r = await request(`/bpmn-diagrams/${id}`, json({ method: "PATCH" }, payload));
  return r.json() as Promise<BpmnDiagram>;
}

export async function deleteBpmnDiagram(id: string): Promise<void> {
  await request(`/bpmn-diagrams/${id}`, { method: "DELETE" });
}

/** Migración única de los diagramas que vivían en el navegador. */
export async function importBpmnDiagrams(
  companyId: string,
  diagrams: BpmnDiagramCreate[],
): Promise<BpmnDiagram[]> {
  const r = await request(
    "/bpmn-diagrams/import",
    json({ method: "POST" }, { company_id: companyId, diagrams }),
  );
  return r.json() as Promise<BpmnDiagram[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Asistente de IA
// ─────────────────────────────────────────────────────────────────────────────

export type ExpertAskRequest = {
  query: string;
  role: string;
  context?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type ExpertAskResponse = {
  answer: string;
  provider: string | null;
  model: string | null;
  success: boolean;
  error: string | null;
};

export async function expertAsk(payload: ExpertAskRequest): Promise<ExpertAskResponse> {
  const r = await request(
    "/cognitive/expert-ask",
    json({ method: "POST" }, {
      query: payload.query,
      role: payload.role,
      context: payload.context ?? null,
      history: payload.history ?? [],
    }),
    AI_TIMEOUT_MS,
  );
  return r.json() as Promise<ExpertAskResponse>;
}

export type CognitivePlanStep = {
  step: number;
  agent: string;
  objective: string;
};

export type CognitiveTrace = {
  ts: string;
  agent: string;
  action: string;
  topic?: string;
  tool?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  duration_ms?: number;
  error?: string;
  entry_id?: string;
};

export type CognitiveAskResponse = {
  session_id: string;
  user_query: string;
  final_answer: string;
  agents_invoked: string[];
  plan: CognitivePlanStep[];
  tools_used: string[];
  blackboard_size: number;
  duration_ms: number;
  findings: Record<string, unknown>[];
  trace: CognitiveTrace[];
  errors: string[];
};

export async function cognitiveAsk(
  query: string,
  sessionId?: string | null,
  processCaseId?: string | null,
): Promise<CognitiveAskResponse> {
  const r = await request(
    "/cognitive/ask",
    json({ method: "POST" }, {
      query,
      session_id: sessionId ?? null,
      process_case_id: processCaseId ?? null,
    }),
    AI_TIMEOUT_MS,
  );
  return r.json() as Promise<CognitiveAskResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grafo de conocimiento
// ─────────────────────────────────────────────────────────────────────────────

export type OrgGraphNode = {
  id: string;
  label: string;
  type:
    | "company"
    | "process"
    | "stakeholder"
    | "interview"
    | "asis"
    | "artifact"
    | "memory"
    | "document"
    | "overlay";
  level?: number | null;
  area?: string | null;
  process_type?: string | null;
  analysis_status?: string | null;
  map_status?: string | null;
  role?: string | null;
  element_type?: string | null;
  artifact_type?: string | null;
  overlay_type?: string | null;
  count?: number;
  sector?: string | null;
  sessions?: number;
  facts?: string[];
};

export type OrgGraphEdge = { source: string; target: string; rel: string };

export type OrgGraph = {
  nodes: OrgGraphNode[];
  edges: OrgGraphEdge[];
  stats: { nodes: number; edges: number; by_type: Record<string, number> };
};

export async function getOrganizationGraph(): Promise<OrgGraph> {
  const r = await request(`/cognitive/graph/organization?_t=${Date.now()}`, { cache: "no-store" });
  return r.json() as Promise<OrgGraph>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de presentación
// ─────────────────────────────────────────────────────────────────────────────

export type OverlayType = "lean" | "six_sigma" | "toc" | "kpi" | "risk";

/** Capa analítica dibujada sobre un elemento del diagrama. */
export type BpmnOverlay = {
  id: string;
  overlay_type: OverlayType;
  element_id: string;
  data: Record<string, unknown>;
  visual: {
    badge_color?: string;
    icon?: string;
    tooltip?: string;
  } | null;
};

/** La aplicación es de acceso libre: no hay login, solo un usuario invitado. */
export type UserReadResponse = {
  id: string;
  username: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
};
