"""
BPM Node Context — builds a rich context dict from a process_case_id so agents
know what BPM node they're working on (level, parent chain, children, BPMN xml).

Used by the contextual AI Workspace: when the user is editing/analyzing a node,
the AI inherits the node's context automatically.
"""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.node_cognitive_context import NodeCognitiveContextModel
from app.models.process_case import ProcessCaseModel


# Modelo jerárquico canónico del proyecto. Lo importa el clasificador de niveles
# (`app.services.bpmn_level_classifier`) para que la clasificación de los nodos
# dibujados en el BPMN use exactamente estos mismos nombres de nivel.
#   N0 Cadena de Valor / Macro-procesos (Porter) · N1 Mapa de Procesos
#   N2 Proceso · N3 Procedimiento · N4 Actividad / Instructivo
LEVEL_NAMES: dict[int, str] = {
    0: "Cadena de Valor",
    1: "Mapa de Procesos",
    2: "Proceso",
    3: "Procedimiento",
    4: "Actividad / Instructivo",
    5: "Tarea",
    6: "Registro",
}


def build_node_context(db: Session, process_case_id: str) -> dict[str, Any] | None:
    """
    Returns a flat dict with everything an agent needs to reason about a BPM node:
      - id, name, level, level_name, parent chain (root → self), children
      - BPMN xml (preview AS-IS if available)
      - analysis_status + staleness
      - applicable_methodologies given the level
    """
    case = db.get(ProcessCaseModel, process_case_id)
    if case is None:
        return None

    # Parent chain (root → self)
    chain: list[dict[str, Any]] = []
    current = case
    visited: set[str] = set()
    while current is not None and current.id not in visited:
        visited.add(current.id)
        chain.append({
            "id": current.id,
            "name": current.name,
            "level": current.level,
            "level_name": LEVEL_NAMES.get(current.level or 0, "Desconocido"),
        })
        if current.parent_id is None:
            break
        current = db.get(ProcessCaseModel, current.parent_id)
    chain.reverse()  # root first

    # Children
    from sqlalchemy import select
    stmt = select(ProcessCaseModel).where(ProcessCaseModel.parent_id == process_case_id)
    children = db.scalars(stmt).all()
    child_summary = [
        {
            "id": c.id, "name": c.name, "level": c.level,
            "analysis_status": c.analysis_status, "staleness": c.staleness,
        }
        for c in children
    ]

    # BPMN preview (best-effort)
    bpmn_xml: str | None = None
    try:
        from app.services.bpmn_modeler_service import BpmnModelerService
        draft = BpmnModelerService(db).preview_as_is_bpmn(UUID(process_case_id))
        if draft is not None:
            bpmn_xml = draft.bpmn_xml
    except Exception:
        bpmn_xml = None

    # Applicable methodologies by level (lista corta, compat) + catálogo de análisis
    # completo anclado en el libro (matriz §3 del framework de niveles).
    from app.methodologies.analysis_catalog import analysis_catalog_for_level
    applicable = _applicable_methodologies(case.level or 1)
    catalog = analysis_catalog_for_level(case.level)

    # Load persisted cognitive context from previous sessions (L3 memory)
    cognitive_ctx = db.get(NodeCognitiveContextModel, process_case_id)
    previous_findings: list[dict] = []
    key_facts: list[str] = []
    open_questions: list[str] = []
    methodology_applied: list[str] = []
    sessions_count: int = 0
    inherited_context: dict = {}
    if cognitive_ctx is not None:
        previous_findings = json.loads(cognitive_ctx.findings or "[]")
        key_facts = json.loads(cognitive_ctx.key_facts or "[]")
        open_questions = json.loads(cognitive_ctx.open_questions or "[]")
        methodology_applied = json.loads(cognitive_ctx.methodology_applied or "[]")
        sessions_count = cognitive_ctx.sessions_count or 0
        inherited_context = json.loads(cognitive_ctx.inherited_context or "{}")

    return {
        "id": case.id,
        "name": case.name,
        "level": case.level,
        "level_name": LEVEL_NAMES.get(case.level or 0, "Desconocido"),
        "process_type": case.process_type,
        "area": case.area,
        "objective": case.objective,
        "scope": case.scope,
        "owner": case.owner,
        "status": case.status,
        "map_status": case.map_status,
        "analysis_status": case.analysis_status,
        "staleness": case.staleness,
        "staleness_reason": case.staleness_reason,
        "transversal": case.transversal,
        "parent_chain": chain,
        "children": child_summary,
        "children_count": len(child_summary),
        "bpmn_xml": bpmn_xml,
        "has_bpmn": bpmn_xml is not None,
        "applicable_methodologies": applicable,
        # ── Matriz de análisis por nivel ─────────────────────────────────────
        "bpm_phases": catalog["bpm_phases"],
        "applicable_analyses": catalog["analyses"],
        # ── L3 Cognitive memory (persisted across sessions) ───────────────────
        "previous_findings": previous_findings,
        "key_facts": key_facts,
        "open_questions": open_questions,
        "methodology_applied": methodology_applied,
        "sessions_count": sessions_count,
        "has_cognitive_history": sessions_count > 0,
        # ── Ola 1-B: context inherited from parent node ───────────────────────
        "inherited_context": inherited_context,
        "has_inherited_context": bool(inherited_context),
    }


def _applicable_methodologies(level: int) -> list[str]:
    """
    No todos los análisis aplican en todos los niveles.
    Modelo: N0 Cadena de Valor · N1 Mapa de Procesos · N2 Proceso ·
            N3 Procedimiento · N4 Actividad/Instructivo.
    """
    if level == 0:
        return ["porter_value_chain", "strategic"]
    if level == 1:
        return ["macro_classification", "ownership", "dependencies"]
    if level == 2:  # Proceso — BPMN de alto nivel
        return ["bpmn_high_level", "stakeholders", "kpi_macro"]
    if level == 3:  # Procedimiento — nivel operativo: Lean/6σ/TOC/simulación
        return [
            "bpmn_operational", "lean", "six_sigma", "toc",
            "monte_carlo", "queue_theory", "kpi", "risks", "fmea",
        ]
    if level == 4:  # Actividad / Instructivo — análisis fino + micro
        return ["bpmn_operational", "lean", "kpi", "risks", "fmea", "activity_micro"]
    return ["activity_micro"]
