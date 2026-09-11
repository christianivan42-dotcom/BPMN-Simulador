"""
Unified Cognitive Workspace API

Single entry point: /api/cognitive/ask
Routes to the orchestrator which coordinates all specialized agents.
"""
from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.cognitive.agents.registry import AGENT_REGISTRY
from app.cognitive.event_bus import EVENT_BUS
from app.cognitive.memory.episodic import EPISODIC_MEMORY
from app.cognitive.memory.semantic import SEMANTIC_MEMORY
from app.cognitive.observability import OBSERVABILITY
from app.cognitive.orchestrator import ORCHESTRATOR
from app.cognitive.shared_state import SHARED_STATES
from app.cognitive.tools.registry import TOOL_REGISTRY
from app.db.session import get_db
from app.graph.factory import get_graph_service

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class CognitiveAskRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=4000)
    session_id: str | None = None
    process_case_id: str | None = None  # Contextual BPM node


class CognitiveAskResponse(BaseModel):
    session_id: str
    user_query: str
    final_answer: str
    agents_invoked: list[str]
    plan: list[dict[str, Any]]
    tools_used: list[str]
    blackboard_size: int
    duration_ms: int
    findings: list[dict[str, Any]]
    trace: list[dict[str, Any]] = []
    errors: list[str] = []


# ── Endpoints ────────────────────────────────────────────────────────────────

# ── Expert Ask (lightweight) ─────────────────────────────────────────────────

class ExpertAskRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=8000)
    role: str = Field(..., min_length=10, max_length=4000,
                      description="System prompt: el rol que la IA debe tomar.")
    context: str | None = Field(None, max_length=8000,
                                description="Contexto adicional opcional (ej. info del nodo activo).")
    history: list[dict[str, str]] = Field(default_factory=list,
                                          description="[{role:'user'|'assistant', content:'...'}, ...]")


class ExpertAskResponse(BaseModel):
    answer: str
    provider: str | None = None
    model: str | None = None
    success: bool = True
    error: str | None = None


@router.post("/expert-ask", response_model=ExpertAskResponse)
def expert_ask(payload: ExpertAskRequest) -> ExpertAskResponse:
    """
    Llamada directa al LLM con rol experto inyectado como system prompt.

    A diferencia de /ask (que pasa por orquestador multi-agente), este endpoint:
    - Es síncrono y rápido
    - Acepta system prompt custom (el rol experto del módulo)
    - No invoca agentes, no usa shared state, no persiste contexto
    - Ideal para chat lateral contextualizado por módulo
    """
    from app.services.llm_client_service import LLMClientService
    from app.services.llm_router_service import AgentTask

    system_prompt = payload.role.strip()
    if payload.context:
        system_prompt += f"\n\nContexto adicional del usuario:\n{payload.context.strip()}"
    system_prompt += (
        "\n\nReglas: Responde de forma concreta, técnica y práctica. "
        "Cita normas/estándares relevantes cuando aplique. Usa Markdown para estructurar. "
        "No describas el sistema BPMS internamente; enfócate en el conocimiento del tema."
    )

    try:
        llm = LLMClientService()
        result = llm.completar(
            system_prompt=system_prompt,
            user_message=payload.query,
            historial=payload.history or [],
            tarea=AgentTask.chat_simple,
        )
        return ExpertAskResponse(
            answer=result.content if result.success else (result.error or "Sin respuesta"),
            provider=str(result.provider) if result.provider else None,
            model=result.model,
            success=result.success,
            error=result.error,
        )
    except Exception as e:
        return ExpertAskResponse(
            answer=f"Error al consultar el LLM: {e}",
            success=False, error=str(e),
        )


@router.post("/ask", response_model=CognitiveAskResponse)
def cognitive_ask(payload: CognitiveAskRequest, db: Session = Depends(get_db)) -> CognitiveAskResponse:
    """Single unified entry point — orchestrator routes to specialized agents."""
    session_id = payload.session_id or str(uuid4())
    response = ORCHESTRATOR.process_query(
        session_id=session_id,
        query=payload.query,
        db=db,
        process_case_id=payload.process_case_id,
    )
    return CognitiveAskResponse(
        session_id=response.session_id,
        user_query=response.user_query,
        final_answer=response.final_answer,
        agents_invoked=response.agents_invoked,
        plan=response.plan,
        tools_used=response.tools_used,
        blackboard_size=response.blackboard_size,
        duration_ms=response.duration_ms,
        findings=response.findings,
        trace=response.trace,
        errors=response.errors,
    )


@router.get("/agents")
def list_cognitive_agents() -> list[dict[str, Any]]:
    """List all registered specialized agents and their capabilities."""
    return AGENT_REGISTRY.describe()


@router.get("/tools")
def list_cognitive_tools() -> list[dict[str, Any]]:
    """List all available cognitive tools."""
    return TOOL_REGISTRY.manifest()


@router.get("/node-context/{process_case_id}")
def get_node_context(process_case_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Return the full BPM node context (parent chain, children, BPMN, applicable methodologies)."""
    from app.cognitive.node_context import build_node_context
    ctx = build_node_context(db, process_case_id)
    if ctx is None:
        raise HTTPException(404, "Node not found")
    return ctx


@router.get("/state/{session_id}")
def get_session_state(session_id: str) -> dict[str, Any]:
    """Inspect the shared state (blackboard) of a session."""
    state = SHARED_STATES.get_or_create(session_id)
    return {
        "session_id": session_id,
        "summary": state.summary(),
        "entries": [
            {
                "id": e.id,
                "topic": e.topic,
                "agent": e.agent,
                "version": e.version,
                "confidence": e.confidence,
                "content": e.content,
            }
            for e in state.all_entries()
        ],
        "trace": state.get_trace(),
    }


@router.delete("/state/{session_id}")
def clear_session_state(session_id: str) -> dict[str, str]:
    SHARED_STATES.discard(session_id)
    return {"status": "cleared", "session_id": session_id}


@router.get("/observability/health")
def cognitive_health() -> dict[str, Any]:
    """Health metrics of the cognitive system."""
    return OBSERVABILITY.health()


@router.get("/observability/agents")
def cognitive_agent_stats() -> list[dict[str, Any]]:
    return OBSERVABILITY.agent_stats()


@router.get("/observability/tools")
def cognitive_tool_stats() -> list[dict[str, Any]]:
    return OBSERVABILITY.tool_stats()


@router.get("/observability/events")
def cognitive_recent_events(n: int = 50, type: str | None = None) -> list[dict[str, Any]]:
    events = EVENT_BUS.recent(n=n, event_type=type)
    return [
        {
            "id": e.id,
            "type": e.type,
            "source": e.source,
            "payload": e.payload,
            "timestamp": e.timestamp.isoformat(),
        }
        for e in events
    ]


@router.get("/memory/episodic/{session_id}")
def get_episodic_memory(session_id: str, n: int | None = None) -> list[dict[str, Any]]:
    turns = EPISODIC_MEMORY.session_turns(session_id, last_n=n)
    return [t.to_dict() for t in turns]


@router.get("/memory/semantic")
def get_semantic_memory(min_confidence: float = 0.0) -> list[dict[str, Any]]:
    facts = SEMANTIC_MEMORY.all_facts(min_confidence=min_confidence)
    return [
        {
            "id": f.id,
            "statement": f.statement,
            "topic": f.topic,
            "confidence": f.confidence,
            "support_count": f.support_count,
            "tags": f.tags,
        }
        for f in facts
    ]


@router.get("/graph/stats")
def graph_stats(db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_graph_service(db).stats()


@router.post("/graph/sync")
def graph_sync(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Resync the knowledge graph from current relational tables."""
    svc = get_graph_service(db)
    synced = svc.sync_from_process_cases()
    return {"synced_nodes": synced, "stats": svc.stats()}


@router.get("/graph/node/{node_id}/subgraph")
def graph_node_subgraph(node_id: str, depth: int = 2, db: Session = Depends(get_db)) -> dict[str, Any]:
    svc = get_graph_service(db)
    if svc.get_node(node_id) is None:
        raise HTTPException(404, "Node not found")
    return svc.subgraph(node_id, max_depth=depth)


@router.get("/graph/organization")
def organization_graph(db: Session = Depends(get_db)) -> dict[str, Any]:
    """
    Grafo COMPLETO de la organización (vista tipo Obsidian) construido en vivo
    desde las tablas relacionales — siempre coherente con lo guardado, sin sync.

    Nodos: empresa, procesos (N0–Nn), stakeholders, entrevistas, elementos AS-IS,
    artefactos, documentos de biblioteca y memoria cognitiva por nodo.
    Aristas: pertenencia (empresa→proceso), jerarquía (padre→hijo), secuencia de
    cadenas N2, y proceso→(stakeholder/entrevista/elemento/artefacto/memoria).
    """
    import json as _json

    from app.models.company import CompanyModel
    from app.models.process_case import ProcessCaseModel
    from app.models.process_repository import ProcessArtifactModel, ProcessRepositoryModel
    from app.models.discovery import (
        ProcessStakeholderModel,
        ProcessInterviewModel,
        ProcessAsIsElementModel,
    )
    from app.services import macro_flow_service as mfs

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_node(nid: str, label: str, ntype: str, **meta: Any) -> None:
        if nid in seen:
            return
        seen.add(nid)
        nodes.append({"id": nid, "label": label or ntype, "type": ntype, **meta})

    def add_edge(src: str, dst: str, rel: str) -> None:
        if src in seen and dst in seen:
            edges.append({"source": src, "target": dst, "rel": rel})

    # 1) Empresa(s) — raíz del grafo
    companies = db.query(CompanyModel).all()
    company_ids = [c.id for c in companies]
    for c in companies:
        add_node(f"company:{c.id}", c.nombre_corto or c.razon_social, "company", sector=c.sector)

    # 2) Procesos (toda la jerarquía N0–Nn)
    cases = db.query(ProcessCaseModel).all()
    for c in cases:
        add_node(
            f"case:{c.id}", c.name, "process",
            level=c.level, area=c.area, process_type=c.process_type,
            analysis_status=c.analysis_status, map_status=c.map_status,
        )
    for c in cases:
        if c.parent_id and f"case:{c.parent_id}" in seen:
            add_edge(f"case:{c.parent_id}", f"case:{c.id}", "subproceso")
        elif not c.parent_id and company_ids:
            # procesos raíz cuelgan de la empresa
            add_edge(f"company:{company_ids[0]}", f"case:{c.id}", "proceso")

    # 3) Cadenas N2 dentro de cada macro (secuencia entre hermanos)
    for c in cases:
        if (c.level or 0) != 1:
            continue
        for chain in mfs.get_flow_definition(db, c.id):
            for a, b in zip(chain, chain[1:]):
                if f"case:{a}" in seen and f"case:{b}" in seen:
                    edges.append({"source": f"case:{a}", "target": f"case:{b}", "rel": "secuencia"})

    # 4) Stakeholders, entrevistas, elementos AS-IS (memoria del levantamiento)
    for s in db.query(ProcessStakeholderModel).all():
        if f"case:{s.case_id}" not in seen:
            continue
        add_node(f"stakeholder:{s.id}", s.name, "stakeholder", role=getattr(s, "role", None))
        add_edge(f"case:{s.case_id}", f"stakeholder:{s.id}", "stakeholder")
    for it in db.query(ProcessInterviewModel).all():
        if f"case:{it.case_id}" not in seen:
            continue
        add_node(f"interview:{it.id}", getattr(it, "title", None) or "Entrevista", "interview")
        add_edge(f"case:{it.case_id}", f"interview:{it.id}", "entrevista")
    for el in db.query(ProcessAsIsElementModel).all():
        if f"case:{el.case_id}" not in seen:
            continue
        add_node(f"asis:{el.id}", getattr(el, "name", None) or "Elemento AS-IS", "asis",
                 element_type=getattr(el, "element_type", None))
        add_edge(f"case:{el.case_id}", f"asis:{el.id}", "as-is")

    # 5) Artefactos (BPMN, documentación) por caso via su repositorio
    repo_to_case = {r.id: r.case_id for r in db.query(ProcessRepositoryModel).all()}
    for art in db.query(ProcessArtifactModel).all():
        cid = repo_to_case.get(art.repository_id)
        if not cid or f"case:{cid}" not in seen:
            continue
        add_node(f"artifact:{art.id}", art.title or art.artifact_type, "artifact",
                 artifact_type=art.artifact_type)
        add_edge(f"case:{cid}", f"artifact:{art.id}", "artefacto")

    # 5b) Overlays de análisis (Lean/6σ/TOC/KPI/Riesgo) agregados por caso y tipo
    try:
        from collections import defaultdict
        from app.models.bpmn_overlay import BpmnOverlayModel
        from app.models.process_repository import ArtifactVersionModel
        art_to_case = {a.id: repo_to_case.get(a.repository_id) for a in db.query(ProcessArtifactModel).all()}
        ver_to_case = {v.id: art_to_case.get(v.artifact_id) for v in db.query(ArtifactVersionModel).all()}
        ov_counts: dict[tuple[str, str], int] = defaultdict(int)
        for ov in db.query(BpmnOverlayModel).all():
            cid = ver_to_case.get(ov.artifact_version_id)
            if cid and f"case:{cid}" in seen:
                ov_counts[(cid, ov.overlay_type)] += 1
        for (cid, otype), cnt in ov_counts.items():
            nid = f"overlay:{cid}:{otype}"
            add_node(nid, f"{otype} ({cnt})", "overlay", overlay_type=otype, count=cnt)
            add_edge(f"case:{cid}", nid, "análisis")
    except Exception:
        pass

    # 6) Memoria cognitiva persistida por nodo — solo HECHOS LEGIBLES (se filtran
    #    UUIDs, blobs JSON y la metadata que ya se ve en el propio nodo).
    import re as _re
    _uuid = _re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-")
    try:
        from app.models.node_cognitive_context import NodeCognitiveContextModel
        case_by_id = {c.id: c for c in cases}
        for m in db.query(NodeCognitiveContextModel).all():
            cid = m.id  # el PK == process_case_id
            if f"case:{cid}" not in seen:
                continue
            case_obj = case_by_id.get(cid)
            _STATUS_NOISE = {
                "draft", "identificado", "documentado", "analizado", "analizado_completo",
                "optimizado", "sin_tobe", "pendiente", "en_analisis", "descompuesto",
                "agregado", "bloqueado", "ok", "activo", "inactivo", "borrador",
                "macro-proceso", "proceso", "subproceso", "procedimiento", "instructivo",
                "propio_modificado", "hijos_modificados", "metricas_obsoletas",
                "estratégico", "operativo", "soporte",
            }
            meta = {
                (case_obj.name or "").strip().lower(),
                (case_obj.area or "").strip().lower(),
                (case_obj.objective or "").strip().lower(),
                (case_obj.process_type or "").strip().lower(),
            } | _STATUS_NOISE if case_obj else set(_STATUS_NOISE)
            try:
                raw = _json.loads(m.key_facts or "[]")
            except Exception:
                raw = []
            clean: list[str] = []
            for f in raw:
                if not isinstance(f, str):
                    continue
                s = f.strip()
                # descarta vacíos, demasiado cortos/largos, UUIDs, blobs JSON/XML/HTML
                # y metadata/estados ya representados en el propio nodo.
                if (not s or len(s) < 4 or len(s) > 160 or _uuid.match(s)
                        or s[:1] in "{[<" or s.lower() in meta):
                    continue
                clean.append(s)
                if len(clean) >= 8:
                    break
            sessions = getattr(m, "sessions_count", 0)
            label = f"Memoria · {sessions} sesión(es)"
            add_node(f"memory:{cid}", label, "memory", sessions=sessions, facts=clean)
            add_edge(f"case:{cid}", f"memory:{cid}", "memoria")
    except Exception:
        pass

    # 7) Documentos de la biblioteca de conocimiento
    try:
        from app.models.knowledge import KnowledgeDocumentModel
        for d in db.query(KnowledgeDocumentModel).all():
            add_node(f"doc:{d.id}", getattr(d, "title", None) or "Documento", "document")
            if company_ids:
                add_edge(f"company:{company_ids[0]}", f"doc:{d.id}", "biblioteca")
    except Exception:
        pass

    type_counts: dict[str, int] = {}
    for n in nodes:
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {"nodes": len(nodes), "edges": len(edges), "by_type": type_counts},
    }


# ── BPMN Intelligence endpoints ──────────────────────────────────────────────

class BpmnAnalyzeRequest(BaseModel):
    xml: str
    include_paths: bool = False
    gateway_probs: dict[str, dict[str, float]] = Field(default_factory=dict)


@router.post("/bpmn/analyze")
def bpmn_analyze_endpoint(payload: BpmnAnalyzeRequest) -> dict[str, Any]:
    """Parse + analyze a BPMN XML — returns structure, findings and (optionally) paths."""
    from app.bpmn_intel.analyzer import BpmnAnalyzer
    from app.bpmn_intel.parser import BpmnParser
    from app.bpmn_intel.paths import PathEnumerator
    graph = BpmnParser.parse(payload.xml)
    result: dict[str, Any] = {
        "process_id": graph.process_id,
        "process_name": graph.process_name,
        "stats": graph.stats(),
        "analysis": BpmnAnalyzer.analyze(graph),
    }
    if payload.include_paths:
        paths = PathEnumerator.enumerate(graph, gateway_probs=payload.gateway_probs)
        result["paths"] = {
            "total": paths.total_paths,
            "truncated": paths.truncated,
            "items": [
                {
                    "probability": round(p.probability, 4),
                    "description": p.description,
                    "sequence": p.sequence,
                    "contains_loop": p.contains_loop,
                }
                for p in paths.paths
            ],
        }
    return result


class BpmnSimulateRequest(BaseModel):
    xml: str
    iterations: int = Field(default=1000, ge=10, le=20000)
    default_task_mean: float = 5.0
    default_task_stdev: float = 2.0
    timings: dict[str, dict[str, Any]] = Field(default_factory=dict)
    gateway_probs: dict[str, dict[str, float]] = Field(default_factory=dict)
    time_unit: str = "minutos"


@router.post("/bpmn/simulate")
def bpmn_simulate_endpoint(payload: BpmnSimulateRequest) -> dict[str, Any]:
    """Run a Monte Carlo simulation on a BPMN."""
    from app.bpmn_intel.parser import BpmnParser
    from app.simulation.monte_carlo import (
        MonteCarloSimulator, NodeTimingProfile, SimulationConfig, TimingDistribution,
    )
    graph = BpmnParser.parse(payload.xml)
    if not graph.start_events():
        raise HTTPException(400, "BPMN sin Start Event — no se puede simular")

    timings: dict[str, NodeTimingProfile] = {}
    for nid, p in payload.timings.items():
        timings[nid] = NodeTimingProfile(
            node_id=nid,
            mean=float(p.get("mean", payload.default_task_mean)),
            stdev=float(p.get("stdev", payload.default_task_stdev)),
            distribution=TimingDistribution(p.get("distribution", "normal")),
        )
    config = SimulationConfig(
        iterations=payload.iterations,
        time_unit=payload.time_unit,
        default_task_mean=payload.default_task_mean,
        default_task_stdev=payload.default_task_stdev,
        timings=timings,
        gateway_probs=payload.gateway_probs,
    )
    return MonteCarloSimulator.run(graph, config).to_dict()


class BpmnImproveRequest(BaseModel):
    xml: str
    signals: dict[str, Any] = Field(default_factory=dict)


@router.post("/bpmn/improve")
def bpmn_improve_endpoint(payload: BpmnImproveRequest) -> dict[str, Any]:
    """Combined improvement pipeline: BPMN analysis + Lean + TOC + methodology recommendations."""
    from app.bpmn_intel.analyzer import BpmnAnalyzer
    from app.bpmn_intel.parser import BpmnParser
    from app.methodologies.lean import LeanMethodology
    from app.methodologies.selector import MethodologySelector
    from app.methodologies.toc import TocMethodology

    graph = BpmnParser.parse(payload.xml)
    if not graph.nodes:
        raise HTTPException(400, "BPMN XML inválido o vacío")

    bpmn_analysis = BpmnAnalyzer.analyze(graph)
    mudas = LeanMethodology.detect_mudas(graph)
    toc_result = TocMethodology.identify_constraints(graph)
    recommendations = MethodologySelector.recommend(graph=graph, signals=payload.signals)

    return {
        "process_id": graph.process_id,
        "process_name": graph.process_name,
        "stats": graph.stats(),
        "bpmn_findings": bpmn_analysis.get("findings", []),
        "severity_counts": bpmn_analysis.get("severity_counts", {}),
        "lean_mudas": [
            {
                "type": m.type.value, "severity": m.severity,
                "description": m.description, "affected_nodes": m.affected_nodes,
                "recommendation": m.recommendation,
            }
            for m in mudas
        ],
        "toc_constraints": toc_result.constraint_candidates,
        "toc_recommendation": toc_result.recommendation,
        "methodology_recommendations": [
            {
                "methodology": r.methodology,
                "score": round(r.score, 2),
                "rationale": r.rationale,
                "next_actions": r.next_actions,
                "artifacts": r.artifacts_to_produce,
            }
            for r in recommendations
        ],
    }


@router.get("/bpmn/methodologies")
def list_methodologies() -> dict[str, Any]:
    """Catalog of methodologies and their frameworks."""
    from app.methodologies.lean import LEAN_TOOLS, MUDA_DESCRIPTIONS
    from app.methodologies.six_sigma import DMAIC_FRAMEWORK
    from app.methodologies.toc import TOC_5_STEPS
    return {
        "lean": {
            "tools": LEAN_TOOLS,
            "mudas": {m.value: desc for m, desc in MUDA_DESCRIPTIONS.items()},
        },
        "six_sigma": {
            "dmaic": [
                {
                    "phase": p.phase.value, "name": p.name, "objective": p.objective,
                    "deliverables": p.deliverables, "tools": p.tools,
                }
                for p in DMAIC_FRAMEWORK.values()
            ],
        },
        "toc": {
            "steps": [
                {"number": s.number, "name": s.name, "objective": s.objective, "actions": s.actions}
                for s in TOC_5_STEPS
            ],
        },
    }
