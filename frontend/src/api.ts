// ── Company / Porter's Value Chain ───────────────────────────────────────────

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

export type HealthResponse = {
  status: string;
  service: string;
  version: string;
  environment: string;
};

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

export type ProcessCaseCreate = {
  name: string;
  area?: string;
  objective?: string;
  scope?: string;
  owner?: string;
  process_type?: ProcessType;
  level?: number;
  parent_id?: string;
  transversal?: boolean;
  related_macro_ids?: string[];
};

export type ProcessCaseTreeNode = {
  id: string;
  name: string;
  area: string | null;
  level: number | null;
  parent_id: string | null;
  process_type: ProcessType | null;
  analysis_status: AnalysisStatus;
  staleness: Staleness;
  transversal: boolean;
  children: ProcessCaseTreeNode[];
};

export type ProcessRepository = {
  id: string;
  case_id: string;
  name: string;
  artifact_count: number;
  created_at: string;
  updated_at: string;
};

export type ArtifactVersion = {
  id: string;
  artifact_id: string;
  version: string;
  status: string;
  content: string;
  change_summary: string | null;
  author: string | null;
  content_hash: string;
  created_at: string;
};

export type ArtifactDecision = {
  id: string;
  version_id: string;
  action: string;
  previous_status: string;
  new_status: string;
  reviewer: string;
  comment: string | null;
  created_at: string;
};

export type ArtifactComment = {
  id: string;
  version_id: string;
  author: string;
  comment: string;
  created_at: string;
};

export type ArtifactVersionHistory = {
  version: ArtifactVersion;
  decisions: ArtifactDecision[];
  comments: ArtifactComment[];
};

export type ArtifactEvidence = {
  id: string;
  version_id: string;
  evidence_type: string;
  source_title: string;
  excerpt: string;
  activity_ref: string | null;
  source_url: string | null;
  notes: string | null;
  created_at: string;
};

export type VersionDiff = {
  base_version_id: string;
  target_version_id: string;
  base_version: string;
  target_version: string;
  added_lines: number;
  removed_lines: number;
  diff: string[];
};

export type QualityCheck = {
  code: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type ArtifactQuality = {
  version_id: string;
  score: number;
  checks: QualityCheck[];
};

export type ProcessArtifact = {
  id: string;
  repository_id: string;
  artifact_type: string;
  title: string;
  description: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  versions: ArtifactVersion[];
};

export type ProcessArtifactCreate = {
  artifact_type: string;
  title: string;
  description?: string;
  content: string;
  version?: string;
  change_summary?: string;
  author?: string;
};

export type ArtifactDecisionCreate = {
  action: string;
  reviewer: string;
  comment?: string;
};

export type ArtifactCommentCreate = {
  author: string;
  comment: string;
};

export type ArtifactVersionCreate = {
  content: string;
  version: string;
  change_summary?: string;
  author?: string;
};

export type ArtifactEvidenceCreate = {
  evidence_type: string;
  source_title: string;
  excerpt: string;
  activity_ref?: string;
  source_url?: string;
  notes?: string;
};

export type KnowledgeDocument = {
  id: string;
  title: string;
  author: string | null;
  source_type: string;
  subject_area: string | null;
  language: string;
  case_id: string | null;
  filename: string;
  mime_type: string | null;
  status: string;
  error_message: string | null;
  text_char_count: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeChunk = {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  char_start: number;
  char_end: number;
  created_at: string;
};

export type ProcessStakeholder = {
  id: string;
  case_id: string;
  name: string;
  role: string;
  area: string | null;
  email: string | null;
  influence_level: string;
  availability: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProcessStakeholderCreate = {
  name: string;
  role: string;
  area?: string;
  email?: string;
  influence_level: string;
  availability?: string;
  notes?: string;
};

export type ProcessInterview = {
  id: string;
  case_id: string;
  stakeholder_id: string | null;
  stakeholder_name: string | null;
  title: string;
  interview_type: string;
  status: string;
  scheduled_at: string | null;
  objective: string | null;
  questions: string | null;
  notes: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

export type ProcessInterviewCreate = {
  stakeholder_id?: string;
  title: string;
  interview_type: string;
  status: string;
  scheduled_at?: string;
  objective?: string;
  questions?: string;
  notes?: string;
  summary?: string;
};

export type InterviewGuideSection = {
  title: string;
  questions: string[];
};

export type InterviewGuide = {
  case_id: string;
  title: string;
  sections: InterviewGuideSection[];
};

export type ProcessAsIsElement = {
  id: string;
  case_id: string;
  interview_id: string | null;
  interview_title: string | null;
  element_type: string;
  name: string;
  description: string | null;
  source_excerpt: string | null;
  confidence_level: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type DiscoveryQuestion = {
  role: string;
  priority: string;
  question_es: string;
  reason_es: string;
  expected_evidence_es: string;
};

export type DiscoveryGap = {
  code: string;
  severity: string;
  title_es: string;
  detail_es: string;
  recommendation_es: string;
};

export type DiscoveryContradiction = {
  topic: string;
  severity: string;
  evidence_es: string[];
  recommendation_es: string;
};

export type DiscoveryCompletenessDimension = {
  code: string;
  label_es: string;
  score: number;
  max_score: number;
  status: string;
  detail_es: string;
};

export type DiscoveryAssessment = {
  case_id: string;
  readiness_level: string;
  completeness_score: number;
  dimensions: DiscoveryCompletenessDimension[];
  generated_questions: DiscoveryQuestion[];
  gaps: DiscoveryGap[];
  contradictions: DiscoveryContradiction[];
  next_actions_es: string[];
};

export type ProcessAsIsElementCreate = {
  interview_id?: string;
  element_type: string;
  name: string;
  description?: string;
  source_excerpt?: string;
  confidence_level: string;
  created_by?: string;
};

export type KnowledgeInsight = {
  id: string;
  document_id: string;
  chunk_id: string;
  insight_type: string;
  topic: string;
  title_es: string;
  summary_es: string;
  source_excerpt: string;
  source_language: string;
  confidence_level: string;
  created_by: string;
  created_at: string;
};

export type KnowledgeLearningRun = {
  analyzed_documents: number;
  created_insights: number;
  total_insights: number;
};

export type CaseMethodologyPhase = {
  phase: string;
  objective_es: string;
  actions_es: string[];
  outputs_es: string[];
  quality_checks_es: string[];
  related_topics: string[];
  source_insight_count: number;
};

export type CaseMethodology = {
  title: string;
  language: string;
  source_insight_count: number;
  phases: CaseMethodologyPhase[];
};

export type AgentTrainingArtifact = {
  name: string;
  kind: string;
  path: string;
  exists: boolean;
  size_bytes: number | null;
};

export type AgentTrainingProfile = {
  profile_name: string;
  training_mode: string;
  language: string;
  books_processed: number;
  pages_processed: number;
  extracted_characters: number;
  insights: number;
  methodology_phases: number;
  dataset_examples: number;
  graph_is_visual: boolean;
  obsidian_vault_path: string;
  obsidian_canvas_path: string;
  artifacts: AgentTrainingArtifact[];
  limitations: string[];
  next_step: string;
};

export type LocalLLMModel = {
  role: string;
  model: string;
  purpose_es: string;
  required: boolean;
  installed: boolean;
};

export type LocalLLMProfile = {
  provider: string;
  runtime: string;
  base_url: string;
  runtime_installed: boolean;
  server_available: boolean;
  reasoning_model: string;
  embedding_model: string;
  pulled_models: string[];
  recommended_models: LocalLLMModel[];
  learning_strategy_es: string[];
  machine_learning_strategy_es: string[];
  install_commands: string[];
  next_actions_es: string[];
};

export type OrchestrationRun = {
  id: string;
  case_id: string;
  status: string;
  current_phase_number: number;
  context_summary: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type OrchestrationPhase = {
  id: string;
  run_id: string;
  phase_number: number;
  phase_key: string;
  title: string;
  agent_role: string;
  objective_es: string;
  expected_outputs_es: string[];
  quality_checks_es: string[];
  status: string;
  requires_human_checkpoint: boolean;
  checkpoint_status: string;
  checkpoint_reviewer: string | null;
  checkpoint_comment: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type OrchestrationEvent = {
  id: string;
  run_id: string;
  phase_number: number | null;
  event_type: string;
  actor: string;
  message_es: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type OrchestrationState = {
  run: OrchestrationRun;
  phases: OrchestrationPhase[];
  events: OrchestrationEvent[];
  next_action_es: string;
  blockers_es: string[];
  autonomy_progress_percent: number;
};

export type CheckpointDecisionCreate = {
  action: "approve" | "reject";
  reviewer: string;
  comment?: string;
};

export type OrchestrationContextCreate = {
  actor?: string;
  message_es: string;
  payload?: Record<string, unknown>;
};

export type BpmnIssue = {
  severity: string;
  code: string;
  message_es: string;
  element_ref: string | null;
};

export type BpmnDraft = {
  case_id: string;
  source_element_count: number;
  task_count: number;
  gateway_count: number;
  bpmn_xml: string;
  issues: BpmnIssue[];
  is_valid: boolean;
  artifact_id: string | null;
  artifact_version_id: string | null;
};

export type BpmnGenerateCreate = {
  title?: string;
  author?: string;
  persist?: boolean;
};

export type AnalysisFinding = {
  finding_type: string;
  severity: string;
  title_es: string;
  detail_es: string;
  evidence_es: string | null;
  recommendation_es: string;
  confidence_level: string;
};

export type AnalysisMetric = {
  name_es: string;
  value: number | null;
  unit: string | null;
  source_es: string;
  interpretation_es: string;
};

export type RiskControl = {
  risk_es: string;
  control_es: string | null;
  status: string;
  recommendation_es: string;
};

export type ImprovementCandidate = {
  title_es: string;
  impact_es: string;
  effort_es: string;
  risk_es: string;
  evidence_es: string | null;
};

export type ProcessAnalysis = {
  case_id: string;
  analysis_score: number;
  findings: AnalysisFinding[];
  metrics: AnalysisMetric[];
  risks_controls: RiskControl[];
  improvement_candidates: ImprovementCandidate[];
  next_actions_es: string[];
};

export type ToBeAlternative = {
  option_type: string;
  title_es: string;
  description_es: string;
  expected_impact_es: string;
  effort_es: string;
  risk_es: string;
  changes_es: string[];
  required_validation_es: string[];
};

export type ProcessRedesign = {
  case_id: string;
  alternatives: ToBeAlternative[];
  comparison: {
    recommended_option_title_es: string;
    rationale_es: string;
    assumptions_es: string[];
  };
  next_actions_es: string[];
};

export type SimulationScenario = {
  name_es: string;
  cycle_time_hours: number;
  manual_effort_hours: number;
  cost_index: number;
  sla_risk: string;
  assumptions_es: string[];
};

export type ProcessSimulation = {
  case_id: string;
  scenarios: SimulationScenario[];
  comparison: {
    baseline_cycle_time_hours: number;
    best_cycle_time_hours: number;
    cycle_time_reduction_percent: number;
    recommended_scenario_es: string;
    interpretation_es: string;
  };
  sensitivity: Array<{
    variable_es: string;
    low_case_es: string;
    base_case_es: string;
    high_case_es: string;
  }>;
  next_actions_es: string[];
};

export type FinalDeliverable = {
  case_id: string;
  executive_summary_es: string;
  technical_summary_es: string;
  implementation_plan: Array<{
    order: number;
    title_es: string;
    owner_es: string;
    timeframe_es: string;
    deliverable_es: string;
  }>;
  decision_points_es: string[];
  residual_risks_es: string[];
  artifact_id: string | null;
  artifact_version_id: string | null;
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8010").trim();
const API_V1 = `${apiBaseUrl}/api/v1`;

// ── Company API ───────────────────────────────────────────────────────────────

export async function getFirstCompany(): Promise<Company | null> {
  const r = await fetch(`${API_V1}/companies/primera`);
  if (!r.ok) throw new Error(`getFirstCompany failed: ${r.status}`);
  const text = await r.text();
  return !text || text === "null" ? null : (JSON.parse(text) as Company);
}

export async function createCompany(payload: CompanyCreate): Promise<Company> {
  const r = await fetch(`${API_V1}/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`createCompany failed: ${r.status}`);
  return r.json() as Promise<Company>;
}

export async function updateCompany(id: string, payload: CompanyUpdate): Promise<Company> {
  const r = await fetch(`${API_V1}/companies/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`updateCompany failed: ${r.status}`);
  return r.json() as Promise<Company>;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_V1}/health`);

  if (!response.ok) {
    throw new Error(`Backend health check failed with ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}

export async function listProcessCases(): Promise<ProcessCase[]> {
  const response = await fetch(`${API_V1}/process-cases`);

  if (!response.ok) {
    throw new Error(`Process cases request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessCase[]>;
}

export async function createProcessCase(payload: ProcessCaseCreate): Promise<ProcessCase> {
  const response = await fetch(`${API_V1}/process-cases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Process case creation failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessCase>;
}

export async function bulkCreateProcessCases(items: ProcessCaseCreate[]): Promise<ProcessCase[]> {
  const r = await fetch(`${API_V1}/process-cases/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!r.ok) throw new Error(`bulkCreateProcessCases failed: ${r.status}`);
  return r.json() as Promise<ProcessCase[]>;
}

export async function getProcessCaseTree(): Promise<ProcessCaseTreeNode[]> {
  const r = await fetch(`${API_V1}/process-cases/tree`);
  if (!r.ok) throw new Error(`getProcessCaseTree failed: ${r.status}`);
  return r.json() as Promise<ProcessCaseTreeNode[]>;
}

// ── Reclasificación manual de nivel (override del analista) ──────────────────

export type LevelOption = { level: number; level_name: string; process_type: string };

export type LevelOptionsResponse = {
  case_id: string;
  current_level: number | null;
  current_type: string | null;
  options: LevelOption[];
};

export async function getLevelOptions(caseId: string): Promise<LevelOptionsResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/level-options`);
  if (!r.ok) throw new Error(`getLevelOptions failed: ${r.status}`);
  return r.json() as Promise<LevelOptionsResponse>;
}

export type ReclassifyResponse = {
  case_id: string;
  level: number;
  process_type: string | null;
  descendants_shifted: number;
};

export async function reclassifyCase(
  caseId: string,
  level: number,
  cascade = true,
): Promise<ReclassifyResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/reclassify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, cascade }),
  });
  if (!r.ok) {
    let detail = `reclassifyCase failed: ${r.status}`;
    try { detail = (await r.json())?.detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return r.json() as Promise<ReclassifyResponse>;
}

export type AggregateDownResponse = {
  root_id: string;
  root_name: string;
  root_level: number | null;
  descendants_total: number;
  with_bpmn: number;
  coverage_pct: number;
  by_type: Record<string, number>;
  per_descendant: Array<{
    id: string;
    name: string;
    level: number | null;
    process_type: string | null;
    has_bpmn: boolean;
    cycle_time_minutes: number | null;
    mudas_count: number;
    findings_count: number;
    error?: string;
  }>;
  aggregated: {
    total_cycle_time_minutes: number;
    mudas_total: number;
    findings_total: number;
    mudas_by_severity: Record<string, number>;
    findings_by_severity: Record<string, number>;
  };
  mudas: Array<{ type: string; severity: string; description: string; source_id: string; source_name: string }>;
  findings: Array<{ code: string; severity: string; title: string; detail: string; source_id: string; source_name: string }>;
};

export type SaveBpmnResponse = {
  case_id: string;
  artifact_id: string | null;
  detection: {
    created: Array<{
      id: string;
      name: string;
      process_type: string;
      bpmn_element_id: string;
      level: number;
      level_name?: string;
      confidence?: string;
      rationale?: string;
    }>;
    skipped_existing: number;
    detected_total: number;
    // Resumen de la clasificación por contexto de los hijos creados, por nivel.
    classification?: Array<{ level: number; level_name: string; count: number }>;
  };
};

export async function saveBpmn(
  caseId: string,
  bpmnXml: string,
  detectSubelements = true,
): Promise<SaveBpmnResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/save-bpmn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bpmn_xml: bpmnXml, detect_subelements: detectSubelements }),
  });
  if (!r.ok) throw new Error(`saveBpmn failed: ${r.status}`);
  return r.json() as Promise<SaveBpmnResponse>;
}

export type AggregateByChainsResponse = {
  root_id: string;
  root_name: string;
  has_flow: boolean;
  chains: Array<{
    index: number;
    kind: string;
    processes: Array<{
      id: string;
      name: string;
      level: number | null;
      has_bpmn: boolean;
      own_cycle_time_minutes: number | null;
      own_mudas_count: number;
      own_findings_count: number;
      descendants_total: number;
      descendants_with_bpmn: number;
    }>;
    descendants_total: number;
    aggregated: {
      total_cycle_time_minutes: number;
      mudas_total: number;
      findings_total: number;
      mudas_by_severity: Record<string, number>;
      findings_by_severity: Record<string, number>;
    };
    mudas: Array<{ type: string; severity: string; description: string; source_id: string; source_name: string }>;
    findings: Array<{ code: string; severity: string; title: string; detail: string; source_id: string; source_name: string }>;
  }>;
};

export async function aggregateByChains(caseId: string): Promise<AggregateByChainsResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/aggregate-by-chains`, {
    method: "POST",
  });
  if (!r.ok) throw new Error(`aggregateByChains failed: ${r.status}`);
  return r.json() as Promise<AggregateByChainsResponse>;
}

export async function aggregateDown(caseId: string): Promise<AggregateDownResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/aggregate-down`, {
    method: "POST",
  });
  if (!r.ok) throw new Error(`aggregateDown failed: ${r.status}`);
  return r.json() as Promise<AggregateDownResponse>;
}

export async function listProcessCaseChildren(caseId: string): Promise<ProcessCase[]> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/children`);
  if (!r.ok) throw new Error(`listProcessCaseChildren failed: ${r.status}`);
  return r.json() as Promise<ProcessCase[]>;
}

export type ProcessCaseUpdate = {
  name?: string;
  objective?: string;
  scope?: string;
  analysis_status?: AnalysisStatus;
  invalidate?: boolean;
};

export async function updateProcessCase(caseId: string, payload: ProcessCaseUpdate): Promise<ProcessCase> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`updateProcessCase failed: ${r.status}`);
  return r.json() as Promise<ProcessCase>;
}

export async function deleteProcessCase(caseId: string): Promise<void> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(`deleteProcessCase failed: ${r.status}`);
}

export async function getProcessCase(caseId: string): Promise<ProcessCase> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}?_t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Process case request failed with ${response.status}`);
  }
  return response.json() as Promise<ProcessCase>;
}

export async function getProcessRepository(caseId: string): Promise<ProcessRepository> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/repository`);

  if (!response.ok) {
    throw new Error(`Process repository request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessRepository>;
}

export async function listProcessArtifacts(caseId: string): Promise<ProcessArtifact[]> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/repository/artifacts`);

  if (!response.ok) {
    throw new Error(`Process artifacts request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessArtifact[]>;
}

export async function createProcessArtifact(
  caseId: string,
  payload: ProcessArtifactCreate,
): Promise<ProcessArtifact> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/repository/artifacts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Process artifact creation failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessArtifact>;
}

export async function createArtifactVersion(
  caseId: string,
  artifactId: string,
  payload: ArtifactVersionCreate,
): Promise<ArtifactVersion> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/repository/artifacts/${artifactId}/versions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Artifact version creation failed with ${response.status}`);
  }

  return response.json() as Promise<ArtifactVersion>;
}

export async function decideArtifactVersion(
  caseId: string,
  versionId: string,
  payload: ArtifactDecisionCreate,
): Promise<ArtifactDecision> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/repository/artifact-versions/${versionId}/decisions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Artifact version decision failed with ${response.status}`);
  }

  return response.json() as Promise<ArtifactDecision>;
}

export async function commentArtifactVersion(
  caseId: string,
  versionId: string,
  payload: ArtifactCommentCreate,
): Promise<ArtifactComment> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/repository/artifact-versions/${versionId}/comments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Artifact version comment failed with ${response.status}`);
  }

  return response.json() as Promise<ArtifactComment>;
}

export async function getArtifactVersionHistory(
  caseId: string,
  versionId: string,
): Promise<ArtifactVersionHistory> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/repository/artifact-versions/${versionId}/history`,
  );

  if (!response.ok) {
    throw new Error(`Artifact version history request failed with ${response.status}`);
  }

  return response.json() as Promise<ArtifactVersionHistory>;
}

export async function compareArtifactVersions(
  caseId: string,
  baseVersionId: string,
  targetVersionId: string,
): Promise<VersionDiff> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/repository/artifact-versions/${baseVersionId}/diff/${targetVersionId}`,
  );

  if (!response.ok) {
    throw new Error(`Artifact version diff request failed with ${response.status}`);
  }

  return response.json() as Promise<VersionDiff>;
}

export async function listArtifactEvidence(
  caseId: string,
  versionId: string,
): Promise<ArtifactEvidence[]> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/repository/artifact-versions/${versionId}/evidence`,
  );

  if (!response.ok) {
    throw new Error(`Artifact evidence request failed with ${response.status}`);
  }

  return response.json() as Promise<ArtifactEvidence[]>;
}

export async function addArtifactEvidence(
  caseId: string,
  versionId: string,
  payload: ArtifactEvidenceCreate,
): Promise<ArtifactEvidence> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/repository/artifact-versions/${versionId}/evidence`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Artifact evidence creation failed with ${response.status}`);
  }

  return response.json() as Promise<ArtifactEvidence>;
}

export async function getArtifactQuality(caseId: string, versionId: string): Promise<ArtifactQuality> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/repository/artifact-versions/${versionId}/quality`,
  );

  if (!response.ok) {
    throw new Error(`Artifact quality request failed with ${response.status}`);
  }

  return response.json() as Promise<ArtifactQuality>;
}

export async function listKnowledgeDocuments(caseId?: string): Promise<KnowledgeDocument[]> {
  const query = caseId ? `?case_id=${encodeURIComponent(caseId)}` : "";
  const response = await fetch(`${API_V1}/knowledge/documents${query}`);

  if (!response.ok) {
    throw new Error(`Knowledge documents request failed with ${response.status}`);
  }

  return response.json() as Promise<KnowledgeDocument[]>;
}

export async function uploadKnowledgeDocument(payload: FormData): Promise<KnowledgeDocument> {
  const response = await fetch(`${API_V1}/knowledge/documents`, {
    method: "POST",
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`Knowledge document upload failed with ${response.status}`);
  }

  return response.json() as Promise<KnowledgeDocument>;
}

export async function uploadKnowledgeDocumentsBulk(payload: FormData): Promise<KnowledgeDocument[]> {
  const response = await fetch(`${API_V1}/knowledge/documents/bulk`, {
    method: "POST",
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`Knowledge documents bulk upload failed with ${response.status}`);
  }

  return response.json() as Promise<KnowledgeDocument[]>;
}

export async function listKnowledgeChunks(documentId: string): Promise<KnowledgeChunk[]> {
  const response = await fetch(`${API_V1}/knowledge/documents/${documentId}/chunks`);

  if (!response.ok) {
    throw new Error(`Knowledge chunks request failed with ${response.status}`);
  }

  return response.json() as Promise<KnowledgeChunk[]>;
}

export async function analyzeKnowledgeLibrary(): Promise<KnowledgeLearningRun> {
  const response = await fetch(`${API_V1}/knowledge/learning/analyze`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Knowledge library analysis failed with ${response.status}`);
  }

  return response.json() as Promise<KnowledgeLearningRun>;
}

export async function listKnowledgeInsights(): Promise<KnowledgeInsight[]> {
  const response = await fetch(`${API_V1}/knowledge/insights`);

  if (!response.ok) {
    throw new Error(`Knowledge insights request failed with ${response.status}`);
  }

  return response.json() as Promise<KnowledgeInsight[]>;
}

export async function getCaseMethodology(): Promise<CaseMethodology> {
  const response = await fetch(`${API_V1}/knowledge/case-methodology`);

  if (!response.ok) {
    throw new Error(`Case methodology request failed with ${response.status}`);
  }

  return response.json() as Promise<CaseMethodology>;
}

export async function getAgentTrainingProfile(): Promise<AgentTrainingProfile> {
  const response = await fetch(`${API_V1}/knowledge/agent-training-profile`);

  if (!response.ok) {
    throw new Error(`Agent training profile request failed with ${response.status}`);
  }

  return response.json() as Promise<AgentTrainingProfile>;
}

export async function getLocalLLMProfile(): Promise<LocalLLMProfile> {
  const response = await fetch(`${API_V1}/local-llm/profile`);

  if (!response.ok) {
    throw new Error(`Local LLM profile request failed with ${response.status}`);
  }

  return response.json() as Promise<LocalLLMProfile>;
}

export async function getCaseOrchestration(caseId: string): Promise<OrchestrationState> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/orchestration`);

  if (!response.ok) {
    throw new Error(`Orchestration request failed with ${response.status}`);
  }

  return response.json() as Promise<OrchestrationState>;
}

export async function startCaseOrchestration(caseId: string): Promise<OrchestrationState> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/orchestration/start`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Orchestration start failed with ${response.status}`);
  }

  return response.json() as Promise<OrchestrationState>;
}

export async function advanceOrchestration(caseId: string): Promise<OrchestrationState> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/orchestration/advance`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Orchestration advance failed with ${response.status}`);
  }

  return response.json() as Promise<OrchestrationState>;
}

export async function decideOrchestrationCheckpoint(
  caseId: string,
  payload: CheckpointDecisionCreate,
): Promise<OrchestrationState> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/orchestration/checkpoint`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Orchestration checkpoint failed with ${response.status}`);
  }

  return response.json() as Promise<OrchestrationState>;
}

export async function rollbackOrchestration(caseId: string): Promise<OrchestrationState> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/orchestration/rollback`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Orchestration rollback failed with ${response.status}`);
  }

  return response.json() as Promise<OrchestrationState>;
}

export async function addOrchestrationContext(
  caseId: string,
  payload: OrchestrationContextCreate,
): Promise<OrchestrationState> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/orchestration/context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Orchestration context failed with ${response.status}`);
  }

  return response.json() as Promise<OrchestrationState>;
}

export async function listProcessStakeholders(caseId: string): Promise<ProcessStakeholder[]> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/discovery/stakeholders`);

  if (!response.ok) {
    throw new Error(`Process stakeholders request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessStakeholder[]>;
}

export async function createProcessStakeholder(
  caseId: string,
  payload: ProcessStakeholderCreate,
): Promise<ProcessStakeholder> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/discovery/stakeholders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Process stakeholder creation failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessStakeholder>;
}

export async function listProcessInterviews(caseId: string): Promise<ProcessInterview[]> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/discovery/interviews`);

  if (!response.ok) {
    throw new Error(`Process interviews request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessInterview[]>;
}

export async function createProcessInterview(
  caseId: string,
  payload: ProcessInterviewCreate,
): Promise<ProcessInterview> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/discovery/interviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Process interview creation failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessInterview>;
}

export async function getInterviewGuide(caseId: string): Promise<InterviewGuide> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/discovery/interview-guide`);

  if (!response.ok) {
    throw new Error(`Interview guide request failed with ${response.status}`);
  }

  return response.json() as Promise<InterviewGuide>;
}

export async function getDiscoveryAssessment(caseId: string): Promise<DiscoveryAssessment> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/discovery/assessment`);

  if (!response.ok) {
    throw new Error(`Discovery assessment request failed with ${response.status}`);
  }

  return response.json() as Promise<DiscoveryAssessment>;
}

export async function listAsIsElements(caseId: string): Promise<ProcessAsIsElement[]> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/discovery/as-is-elements`);

  if (!response.ok) {
    throw new Error(`As-is elements request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessAsIsElement[]>;
}

export async function createAsIsElement(
  caseId: string,
  payload: ProcessAsIsElementCreate,
): Promise<ProcessAsIsElement> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/discovery/as-is-elements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`As-is element creation failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessAsIsElement>;
}

export async function extractAsIsElements(
  caseId: string,
  interviewId: string,
): Promise<ProcessAsIsElement[]> {
  const response = await fetch(
    `${API_V1}/process-cases/${caseId}/discovery/interviews/${interviewId}/extract-as-is`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`As-is extraction failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessAsIsElement[]>;
}

export async function previewAsIsBpmn(caseId: string): Promise<BpmnDraft> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/bpmn/as-is/preview`);

  if (!response.ok) {
    throw new Error(`BPMN preview request failed with ${response.status}`);
  }

  return response.json() as Promise<BpmnDraft>;
}

export async function generateAsIsBpmn(caseId: string, payload: BpmnGenerateCreate): Promise<BpmnDraft> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/bpmn/as-is/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`BPMN generation failed with ${response.status}`);
  }

  return response.json() as Promise<BpmnDraft>;
}

export async function getProcessAnalysis(caseId: string): Promise<ProcessAnalysis> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/analysis`);

  if (!response.ok) {
    throw new Error(`Process analysis request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessAnalysis>;
}

export async function createProcessAnalysisReport(caseId: string): Promise<ProcessAnalysis> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/analysis/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Analisis as-is generado por agente",
      author: "Agente Analista",
      persist: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Process analysis report failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessAnalysis>;
}

export async function getProcessRedesign(caseId: string): Promise<ProcessRedesign> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/redesign/to-be-options`);

  if (!response.ok) {
    throw new Error(`Process redesign request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessRedesign>;
}

export async function createProcessRedesignReport(caseId: string): Promise<ProcessRedesign> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/redesign/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Propuesta to-be generada por agente",
      author: "Agente Redisenador",
      persist: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Process redesign report failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessRedesign>;
}

export async function getProcessSimulation(caseId: string): Promise<ProcessSimulation> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/simulation/scenarios`);

  if (!response.ok) {
    throw new Error(`Process simulation request failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessSimulation>;
}

export async function createProcessSimulationReport(caseId: string): Promise<ProcessSimulation> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/simulation/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Simulacion inicial generada por agente",
      author: "Agente Simulador",
      persist: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Process simulation report failed with ${response.status}`);
  }

  return response.json() as Promise<ProcessSimulation>;
}

export async function getFinalDeliverable(caseId: string): Promise<FinalDeliverable> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/deliverables/final-report`);

  if (!response.ok) {
    throw new Error(`Final deliverable request failed with ${response.status}`);
  }

  return response.json() as Promise<FinalDeliverable>;
}

export async function createFinalDeliverable(caseId: string): Promise<FinalDeliverable> {
  const response = await fetch(`${API_V1}/process-cases/${caseId}/deliverables/final-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Informe final generado por agente",
      author: "Agente Redactor",
      persist: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Final deliverable creation failed with ${response.status}`);
  }

  return response.json() as Promise<FinalDeliverable>;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHAT — Agente BPMS Conversacional
// ══════════════════════════════════════════════════════════════════════════════

export type ChatSession = {
  id: string;
  case_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  llm_provider: string | null;
  llm_model: string | null;
  rag_fragments_used: number | null;
  normalized_terms: string | null;
  agent_task: string | null;
  created_at: string;
};

export type ChatSessionCreate = {
  title?: string;
  case_id?: string;
};

export type ChatMessageCreate = {
  content: string;
};

export type RAGFragment = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  author: string | null;
  content: string;
  score: number;
  chunk_index: number;
};

export type RAGSearchResponse = {
  query: string;
  fragments: RAGFragment[];
  total_found: number;
};

export type LLMProviderStatus = {
  provider: string;
  model: string;
  available: boolean;
  api_key_configured: boolean;
  notes: string | null;
};

export type LLMSystemStatus = {
  providers: LLMProviderStatus[];
  active_provider: string;
  ollama_available: boolean;
  internet_available: boolean;
};

export async function listChatSessions(): Promise<ChatSession[]> {
  const r = await fetch(`${API_V1}/chat/sessions`);
  if (!r.ok) throw new Error(`listChatSessions failed: ${r.status}`);
  return r.json() as Promise<ChatSession[]>;
}

export async function createChatSession(payload: ChatSessionCreate): Promise<ChatSession> {
  const r = await fetch(`${API_V1}/chat/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`createChatSession failed: ${r.status}`);
  return r.json() as Promise<ChatSession>;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const r = await fetch(`${API_V1}/chat/sessions/${sessionId}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(`deleteChatSession failed: ${r.status}`);
}

export async function getChatSession(sessionId: string): Promise<ChatSession> {
  const r = await fetch(`${API_V1}/chat/sessions/${sessionId}`);
  if (!r.ok) throw new Error(`getChatSession failed: ${r.status}`);
  return r.json() as Promise<ChatSession>;
}

export async function listChatMessages(sessionId: string): Promise<ChatMessage[]> {
  const r = await fetch(`${API_V1}/chat/sessions/${sessionId}/messages`);
  if (!r.ok) throw new Error(`listChatMessages failed: ${r.status}`);
  return r.json() as Promise<ChatMessage[]>;
}

export async function sendChatMessage(
  sessionId: string,
  payload: ChatMessageCreate,
): Promise<ChatMessage> {
  const r = await fetch(`${API_V1}/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`sendChatMessage failed: ${r.status}`);
  return r.json() as Promise<ChatMessage>;
}

export async function searchRAG(
  query: string,
  topK = 5,
  caseId?: string,
): Promise<RAGSearchResponse> {
  const r = await fetch(`${API_V1}/chat/rag/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK, case_id: caseId ?? null }),
  });
  if (!r.ok) throw new Error(`searchRAG failed: ${r.status}`);
  return r.json() as Promise<RAGSearchResponse>;
}

export async function getLLMSystemStatus(): Promise<LLMSystemStatus> {
  const r = await fetch(`${API_V1}/chat/llm/status`);
  if (!r.ok) throw new Error(`getLLMSystemStatus failed: ${r.status}`);
  return r.json() as Promise<LLMSystemStatus>;
}

// ══════════════════════════════════════════════════════════════════════════════
// COGNITIVE ENTERPRISE PLATFORM — Unified AI Workspace
// ══════════════════════════════════════════════════════════════════════════════

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

export type CognitiveAgentInfo = {
  name: string;
  description: string;
  capabilities: string[];
  keywords: string[];
};

export type CognitiveToolInfo = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  category: string;
  cost: string;
};

export type BlackboardEntryView = {
  id: string;
  topic: string;
  agent: string;
  version: number;
  confidence: number;
  content: unknown;
};

export type CognitiveStateView = {
  session_id: string;
  summary: {
    total_entries: number;
    topics: string[];
    agents_involved: string[];
    latest_by_topic: Record<string, unknown>;
  };
  entries: BlackboardEntryView[];
  trace: CognitiveTrace[];
};

export type CognitiveAgentStat = {
  agent: string;
  invocations: number;
  failures: number;
  success_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
};

export type CognitiveToolStat = {
  tool: string;
  calls: number;
  failures: number;
  success_rate: number;
  avg_duration_ms: number;
};

export type CognitiveHealth = {
  agents_registered: number;
  total_invocations: number;
  total_failures: number;
  success_rate: number;
  total_tool_calls: number;
  active_sessions: number;
};

export type GraphNodeDTO = {
  id: string;
  type: string;
  external_key: string | null;
  label: string;
  properties: Record<string, unknown>;
};

export type GraphEdgeDTO = {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  weight: number;
  properties: Record<string, unknown>;
};

export type GraphSubgraphDTO = {
  root_id: string;
  depth: number;
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
};

export type GraphStats = {
  total_nodes: number;
  total_edges: number;
  nodes_by_type: Record<string, number>;
  edges_by_type: Record<string, number>;
};

export async function cognitiveAsk(
  query: string,
  sessionId?: string | null,
  processCaseId?: string | null,
): Promise<CognitiveAskResponse> {
  const r = await fetch(`${API_V1}/cognitive/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      session_id: sessionId ?? null,
      process_case_id: processCaseId ?? null,
    }),
  });
  if (!r.ok) throw new Error(`cognitiveAsk failed: ${r.status}`);
  return r.json() as Promise<CognitiveAskResponse>;
}

// ── Grafo organizacional completo (vista tipo Obsidian) ─────────────────────
export type OrgGraphNode = {
  id: string;
  label: string;
  type: "company" | "process" | "stakeholder" | "interview" | "asis" | "artifact" | "memory" | "document" | "overlay";
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
  const r = await fetch(`${API_V1}/cognitive/graph/organization?_t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`getOrganizationGraph failed: ${r.status}`);
  return r.json() as Promise<OrgGraph>;
}

export async function getNodeSubgraph(nodeId: string, depth = 2): Promise<GraphSubgraphDTO> {
  const r = await fetch(`${API_V1}/cognitive/graph/node/${nodeId}/subgraph?depth=${depth}`);
  if (!r.ok) throw new Error(`getNodeSubgraph failed: ${r.status}`);
  return r.json() as Promise<GraphSubgraphDTO>;
}

// ── BPMN Intelligence ────────────────────────────────────────────────────────

export type BpmnFinding = {
  code: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  affected_nodes: string[];
  recommendation: string | null;
};

export type BpmnAnalyzeResponse = {
  process_id: string;
  process_name: string;
  stats: {
    total_nodes: number;
    total_flows: number;
    tasks: number;
    gateways: number;
    events: number;
    lanes: number;
    pools: number;
    start_events: number;
    end_events: number;
  };
  analysis: {
    stats: Record<string, number>;
    findings: BpmnFinding[];
    severity_counts: { info: number; warning: number; error: number };
  };
  paths?: {
    total: number;
    truncated: boolean;
    items: Array<{ probability: number; description: string; sequence: string[]; contains_loop: boolean }>;
  };
};

export type BpmnSimulateResponse = {
  iterations: number;
  completed_iterations: number;
  truncated_iterations: number;
  mean_cycle_time: number;
  median_cycle_time: number;
  min_cycle_time: number;
  max_cycle_time: number;
  p5_cycle_time: number;
  p95_cycle_time: number;
  stdev_cycle_time: number;
  node_visits: Record<string, number>;
  node_total_time: Record<string, number>;
  time_unit: string;
};

export type LeanMudaFinding = {
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  affected_nodes: string[];
  recommendation: string;
};

export type MethodologyRecommendation = {
  methodology: string;
  score: number;
  rationale: string;
  next_actions: string[];
  artifacts: string[];
};

export type BpmnImproveResponse = {
  process_id: string;
  process_name: string;
  stats: Record<string, number>;
  bpmn_findings: BpmnFinding[];
  severity_counts: { info: number; warning: number; error: number };
  lean_mudas: LeanMudaFinding[];
  toc_constraints: Array<Record<string, unknown>>;
  toc_recommendation: string;
  methodology_recommendations: MethodologyRecommendation[];
};

export type MethodologiesCatalog = {
  lean: {
    tools: Record<string, string>;
    mudas: Record<string, string>;
  };
  six_sigma: {
    dmaic: Array<{
      phase: string;
      name: string;
      objective: string;
      deliverables: string[];
      tools: string[];
    }>;
  };
  toc: {
    steps: Array<{ number: number; name: string; objective: string; actions: string[] }>;
  };
};

export async function bpmnAnalyze(xml: string, includePaths = false): Promise<BpmnAnalyzeResponse> {
  const r = await fetch(`${API_V1}/cognitive/bpmn/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xml, include_paths: includePaths }),
  });
  if (!r.ok) throw new Error(`bpmnAnalyze failed: ${r.status}`);
  return r.json() as Promise<BpmnAnalyzeResponse>;
}

export async function bpmnSimulate(
  xml: string,
  options?: {
    iterations?: number;
    default_task_mean?: number;
    default_task_stdev?: number;
    time_unit?: string;
    timings?: Record<string, { mean: number; stdev?: number; distribution?: string }>;
    gateway_probs?: Record<string, Record<string, number>>;
  },
): Promise<BpmnSimulateResponse> {
  const r = await fetch(`${API_V1}/cognitive/bpmn/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xml, ...options }),
  });
  if (!r.ok) throw new Error(`bpmnSimulate failed: ${r.status}`);
  return r.json() as Promise<BpmnSimulateResponse>;
}

export async function bpmnImprove(
  xml: string,
  signals?: Record<string, unknown>,
): Promise<BpmnImproveResponse> {
  const r = await fetch(`${API_V1}/cognitive/bpmn/improve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xml, signals: signals ?? {} }),
  });
  if (!r.ok) throw new Error(`bpmnImprove failed: ${r.status}`);
  return r.json() as Promise<BpmnImproveResponse>;
}

export async function listMethodologies(): Promise<MethodologiesCatalog> {
  const r = await fetch(`${API_V1}/cognitive/bpmn/methodologies`);
  if (!r.ok) throw new Error(`listMethodologies failed: ${r.status}`);
  return r.json() as Promise<MethodologiesCatalog>;
}

// ── BPMN Overlay API ──────────────────────────────────────────────────────────

export type OverlayType = "lean" | "six_sigma" | "toc" | "kpi" | "risk";

export type BpmnOverlay = {
  id: string;
  artifact_version_id: string;
  overlay_type: OverlayType;
  element_id: string;
  data: Record<string, unknown>;
  visual: {
    badge_color?: string;
    icon?: string;
    tooltip?: string;
  } | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BpmnOverlayCreate = {
  element_id: string;
  data: Record<string, unknown>;
  visual?: { badge_color?: string; icon?: string; tooltip?: string };
  created_by?: string;
};

export type BpmnOverlayListResponse = {
  overlays: BpmnOverlay[];
  total: number;
};

export async function listBpmnOverlays(
  caseId: string,
  versionId: string,
  overlayType?: OverlayType,
): Promise<BpmnOverlayListResponse> {
  const url = new URL(`${API_V1}/process-cases/${caseId}/bpmn/versions/${versionId}/overlays`);
  if (overlayType) url.searchParams.set("overlay_type", overlayType);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`listBpmnOverlays failed: ${r.status}`);
  return r.json() as Promise<BpmnOverlayListResponse>;
}

export async function createBpmnOverlay(
  caseId: string,
  versionId: string,
  overlayType: OverlayType,
  payload: BpmnOverlayCreate,
): Promise<BpmnOverlay> {
  const r = await fetch(
    `${API_V1}/process-cases/${caseId}/bpmn/versions/${versionId}/overlays/${overlayType}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!r.ok) throw new Error(`createBpmnOverlay failed: ${r.status}`);
  return r.json() as Promise<BpmnOverlay>;
}

export async function deleteBpmnOverlay(
  caseId: string,
  versionId: string,
  overlayId: string,
): Promise<void> {
  const r = await fetch(
    `${API_V1}/process-cases/${caseId}/bpmn/versions/${versionId}/overlays/${overlayId}`,
    { method: "DELETE" },
  );
  if (!r.ok) throw new Error(`deleteBpmnOverlay failed: ${r.status}`);
}

// ── BPMN Semantic Version History (Ola 2-C) ───────────────────────────────────

export type SemanticChangeKind =
  | "added"
  | "removed"
  | "renamed"
  | "retyped"
  | "flow_added"
  | "flow_removed";

export type SemanticChange = {
  kind: SemanticChangeKind;
  element_id: string;
  description: string;
  detail: Record<string, unknown>;
};

export type BpmnSemanticDiff = {
  base_version_id: string;
  target_version_id: string;
  base_version: string;
  target_version: string;
  summary: string;
  total_changes: number;
  changes: SemanticChange[];
  computed_at: string | null;
};

export type BpmnVersionSummary = {
  version_id: string;
  version: string;
  status: string;
  author: string | null;
  change_summary: string | null;
  created_at: string;
  diff_summary: string | null;
  total_changes: number | null;
};

export type BpmnVersionHistory = {
  artifact_id: string;
  artifact_title: string;
  versions: BpmnVersionSummary[];
  total: number;
};

export async function getBpmnVersionHistory(
  caseId: string,
  artifactId: string,
): Promise<BpmnVersionHistory> {
  const r = await fetch(
    `${API_V1}/process-cases/${caseId}/bpmn/artifacts/${artifactId}/versions`,
  );
  if (!r.ok) throw new Error(`getBpmnVersionHistory failed: ${r.status}`);
  return r.json() as Promise<BpmnVersionHistory>;
}

export async function getBpmnSemanticDiff(
  caseId: string,
  baseVersionId: string,
  targetVersionId: string,
): Promise<BpmnSemanticDiff> {
  const r = await fetch(
    `${API_V1}/process-cases/${caseId}/bpmn/versions/${baseVersionId}/diff/${targetVersionId}`,
  );
  if (!r.ok) throw new Error(`getBpmnSemanticDiff failed: ${r.status}`);
  return r.json() as Promise<BpmnSemanticDiff>;
}

// ── DES Simulation (SimPy async) ──────────────────────────────────────────────

export type DesSimulationParams = {
  num_resources?: number;
  sim_time?: number;
  arrival_rate?: number;
};

export type DesTaskLaunchResponse = {
  task_id: string;
  status: string;
  message?: string;
};

export type TaskResultResponse = {
  task_id: string;
  status: "running" | "success" | "failure" | string;
  result?: Record<string, unknown> | null;
  error?: string | null;
};

export async function runDesSimulationAsync(
  caseId: string,
  params?: DesSimulationParams,
): Promise<DesTaskLaunchResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/simulation/discrete/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  if (!r.ok) throw new Error(`runDesSimulationAsync failed: ${r.status}`);
  return r.json() as Promise<DesTaskLaunchResponse>;
}

export async function getTaskStatus(taskId: string): Promise<TaskResultResponse> {
  const r = await fetch(`${API_V1}/tasks/${taskId}`);
  if (!r.ok) throw new Error(`getTaskStatus failed: ${r.status}`);
  return r.json() as Promise<TaskResultResponse>;
}

// ── Governance / Auth ─────────────────────────────────────────────────────────

export type UserLoginPayload = { username: string; password: string };

export type UserReadResponse = {
  id: string;
  username: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
};

export type LoginResponse = { user: UserReadResponse };

export async function loginUser(username: string, password: string): Promise<LoginResponse> {
  const r = await fetch(`${API_V1}/governance/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({})) as { detail?: string };
    throw new Error(detail.detail ?? `Login failed: ${r.status}`);
  }
  return r.json() as Promise<LoginResponse>;
}

// ── Collaboration (Approvals + Comments) ──────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ApprovalResponse = {
  id: string;
  process_case_id: string;
  title: string;
  description: string | null;
  status: ApprovalStatus;
  requested_by: string;
  assigned_to: string | null;
  artifact_version_id: string | null;
  due_date: string | null;
  resolved_at: string | null;
  resolution_comment: string | null;
  created_at: string;
  updated_at: string;
};

export type ApprovalCreate = {
  title: string;
  requested_by: string;
  description?: string;
  assigned_to?: string;
  artifact_version_id?: string;
  due_date?: string;
};

export type ApprovalResolve = {
  action: "approve" | "reject" | "cancel";
  resolved_by: string;
  comment?: string;
};

export type CommentResponse = {
  id: string;
  process_case_id: string;
  author: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CommentCreate = {
  author: string;
  content: string;
  parent_id?: string;
};

export async function listApprovals(caseId: string): Promise<ApprovalResponse[]> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/approvals`);
  if (!r.ok) throw new Error(`listApprovals failed: ${r.status}`);
  return r.json() as Promise<ApprovalResponse[]>;
}

export async function createApproval(caseId: string, payload: ApprovalCreate): Promise<ApprovalResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`createApproval failed: ${r.status}`);
  return r.json() as Promise<ApprovalResponse>;
}

export async function resolveApproval(
  caseId: string,
  approvalId: string,
  payload: ApprovalResolve,
): Promise<ApprovalResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/approvals/${approvalId}/resolve`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`resolveApproval failed: ${r.status}`);
  return r.json() as Promise<ApprovalResponse>;
}

export async function listComments(caseId: string): Promise<CommentResponse[]> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/comments`);
  if (!r.ok) throw new Error(`listComments failed: ${r.status}`);
  return r.json() as Promise<CommentResponse[]>;
}

export async function createComment(caseId: string, payload: CommentCreate): Promise<CommentResponse> {
  const r = await fetch(`${API_V1}/process-cases/${caseId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`createComment failed: ${r.status}`);
  return r.json() as Promise<CommentResponse>;
}

// ── Expert Ask (direct LLM with custom role/system-prompt) ────────────────────

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
  const r = await fetch(`${API_V1}/cognitive/expert-ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: payload.query,
      role: payload.role,
      context: payload.context ?? null,
      history: payload.history ?? [],
    }),
  });
  if (!r.ok) throw new Error(`expertAsk failed: ${r.status}`);
  return r.json() as Promise<ExpertAskResponse>;
}
