"""
Lean Methodology — 8 Mudas (waste types) + Lean tools.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.bpmn_intel.parser import TASK_KINDS, NodeKind, ProcessGraph


class MudaType(StrEnum):
    """The 8 wastes in Lean (TIMWOODS)."""
    TRANSPORTATION = "transportation"
    INVENTORY = "inventory"
    MOTION = "motion"
    WAITING = "waiting"
    OVERPRODUCTION = "overproduction"
    OVER_PROCESSING = "over_processing"
    DEFECTS = "defects"
    SKILLS = "skills"


MUDA_DESCRIPTIONS: dict[MudaType, str] = {
    MudaType.TRANSPORTATION: "Movimiento innecesario de información o documentos entre actividades/áreas",
    MudaType.INVENTORY: "Tareas represadas, colas de trabajo, emails sin responder",
    MudaType.MOTION: "Personas buscando información, aprobaciones en múltiples sistemas",
    MudaType.WAITING: "Aprobaciones lentas, dependencias bloqueantes, batch processing",
    MudaType.OVERPRODUCTION: "Reportes que nadie lee, pasos que no agregan valor",
    MudaType.OVER_PROCESSING: "Revisiones duplicadas, aprobaciones innecesarias",
    MudaType.DEFECTS: "Retrabajos, errores, correcciones, excepciones frecuentes",
    MudaType.SKILLS: "Talento humano haciendo tareas que podrían automatizarse",
}


@dataclass
class MudaFinding:
    type: MudaType
    description: str
    severity: str  # low | medium | high
    affected_nodes: list[str]
    recommendation: str


class LeanMethodology:
    """Lean analysis applied to a ProcessGraph."""

    @staticmethod
    def detect_mudas(graph: ProcessGraph) -> list[MudaFinding]:
        findings: list[MudaFinding] = []

        # 1. Waiting — long approval chains
        approval_terms = ("aprob", "autoriz", "valid", "revis", "verifi", "confirm")
        approval_count = sum(
            1 for n in graph.tasks()
            if any(t in (n.name or "").lower() for t in approval_terms)
        )
        if approval_count >= 3:
            findings.append(MudaFinding(
                type=MudaType.WAITING,
                description=f"{approval_count} actividades de aprobación/validación detectadas",
                severity="high" if approval_count >= 5 else "medium",
                affected_nodes=[
                    n.id for n in graph.tasks()
                    if any(t in (n.name or "").lower() for t in approval_terms)
                ],
                recommendation="Consolidar aprobaciones, automatizar reglas, definir excepciones",
            ))

        # 2. Defects — loops in the graph indicate rework
        # (we already detect cycles in the analyzer — here we tag them as muda)
        from app.bpmn_intel.analyzer import BpmnAnalyzer
        loops = BpmnAnalyzer.detect_loops(graph)
        if loops:
            affected = list(set(nid for f in loops for nid in f.affected_nodes))
            findings.append(MudaFinding(
                type=MudaType.DEFECTS,
                description=f"{len(loops)} loops de reproceso detectados",
                severity="high",
                affected_nodes=affected,
                recommendation="Investigar causa raíz del rework (5 Whys, Ishikawa)",
            ))

        # 3. Over-processing — duplicate task names
        from collections import Counter
        names = [n.name.lower().strip() for n in graph.tasks() if n.name.strip()]
        dup_names = [name for name, count in Counter(names).items() if count >= 2]
        if dup_names:
            affected = [
                n.id for n in graph.tasks()
                if n.name.lower().strip() in dup_names
            ]
            findings.append(MudaFinding(
                type=MudaType.OVER_PROCESSING,
                description=f"{len(dup_names)} actividades duplicadas detectadas",
                severity="medium",
                affected_nodes=affected,
                recommendation="Consolidar actividades duplicadas si son la misma operación",
            ))

        # 4. Skills — manual tasks that could be service tasks
        manual = [n for n in graph.tasks() if n.kind in (NodeKind.MANUAL_TASK, NodeKind.USER_TASK)]
        if len(manual) >= len(graph.tasks()) * 0.7 and len(manual) >= 5:
            findings.append(MudaFinding(
                type=MudaType.SKILLS,
                description=f"{len(manual)} tareas manuales/usuario sobre {len(graph.tasks())} totales",
                severity="medium",
                affected_nodes=[n.id for n in manual],
                recommendation="Evaluar candidatos a automatización RPA o sistemas",
            ))

        # 5. Inventory — long sequential chains accumulate WIP
        from app.bpmn_intel.analyzer import BpmnAnalyzer
        chains = BpmnAnalyzer.detect_long_sequential_chains(graph, min_length=6)
        if chains:
            affected = list({nid for f in chains for nid in f.affected_nodes})
            findings.append(MudaFinding(
                type=MudaType.INVENTORY,
                description=f"Cadena(s) muy larga(s) sin checkpoints acumulan WIP",
                severity="medium",
                affected_nodes=affected,
                recommendation="Insertar pull / dividir en sub-procesos paralelos",
            ))

        return findings

    @staticmethod
    def applicability_score(graph: ProcessGraph) -> dict[str, Any]:
        """Heuristic score: when does Lean apply best?"""
        tasks = len(graph.tasks())
        if tasks == 0:
            return {"score": 0.0, "rationale": "Sin tareas — no aplicable"}
        score = 0.5
        rationale = []

        # Manual-heavy → Lean applies
        manual = sum(1 for n in graph.tasks() if n.kind in (NodeKind.MANUAL_TASK, NodeKind.USER_TASK))
        ratio = manual / tasks
        if ratio > 0.6:
            score += 0.2
            rationale.append(f"{int(ratio*100)}% tareas manuales — Lean valioso")

        # Long chains → Lean
        from app.bpmn_intel.analyzer import BpmnAnalyzer
        if BpmnAnalyzer.detect_long_sequential_chains(graph, min_length=5):
            score += 0.2
            rationale.append("Cadenas secuenciales largas — VSM aplicable")

        return {"score": min(1.0, score), "rationale": "; ".join(rationale) or "Lean genérico aplica"}


LEAN_TOOLS = {
    "VSM": "Value Stream Mapping — mapear flujo de valor end-to-end con tiempos",
    "5S": "Sort, Set in order, Shine, Standardize, Sustain — orden visual",
    "Kanban": "Sistema visual de tirón para limitar WIP",
    "Poka-Yoke": "Mistake-proofing — diseñar para evitar errores",
    "Heijunka": "Nivelación de producción",
    "SMED": "Single-Minute Exchange of Die — reducir tiempos de setup",
    "Gemba Walk": "Observación directa en el lugar donde ocurre el trabajo",
    "Kaizen Event": "Mejora rápida focalizada (3-5 días)",
}
