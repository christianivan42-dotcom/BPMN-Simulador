"""
MethodologySelector — Decides which methodology(ies) apply to a given context.

Uses a rule-based scoring system. The selector returns a ranked list:
each entry has methodology name, score, rationale, and recommended next actions.

Rules (from BPM-CBOK, Master Black Belt heuristics):
    - Variabilidad alta → Six Sigma
    - Desperdicio alto / proceso lento → Lean
    - Cuello de botella sistémico → TOC
    - Problema complejo desconocido → A3 + 5 Whys
    - Nuevo diseño → DMADV / DFSS
    - Mejora rápida (<3 meses) → Kaizen Event
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.bpmn_intel.parser import ProcessGraph


@dataclass
class MethodologyRecommendation:
    methodology: str
    score: float
    rationale: str
    next_actions: list[str]
    artifacts_to_produce: list[str]


class MethodologySelector:
    """Rule-based + heuristic selector."""

    @staticmethod
    def recommend(
        graph: ProcessGraph | None = None,
        signals: dict[str, Any] | None = None,
    ) -> list[MethodologyRecommendation]:
        """
        signals can include:
            - "variability_high": bool   (alta variabilidad en outputs)
            - "rework_loops": int         (loops detectados en BPMN)
            - "approval_chain": int       (longitud de cadena de aprobaciones)
            - "bottleneck_detected": bool
            - "manual_task_ratio": float  (0..1)
            - "user_intent": str          ('rediseno', 'optimizar', 'analizar', etc.)
            - "timeframe_months": int     (horizonte temporal)
        """
        signals = signals or {}
        if graph is not None:
            from app.bpmn_intel.analyzer import BpmnAnalyzer
            from app.methodologies.lean import LeanMethodology
            # Compute signals from graph
            analyzer = BpmnAnalyzer.analyze(graph)
            loops = [f for f in analyzer["findings"] if f["code"] == "loop_detected"]
            approvals = [f for f in analyzer["findings"] if f["code"] == "approval_chain"]
            mudas = LeanMethodology.detect_mudas(graph)
            signals.setdefault("rework_loops", len(loops))
            signals.setdefault("approval_chain", max((len(f["affected_nodes"]) for f in approvals), default=0))
            signals.setdefault("manual_task_ratio", _manual_task_ratio(graph))
            signals.setdefault("muda_count", len(mudas))

        recommendations: list[MethodologyRecommendation] = []

        # Six Sigma — variability / defects
        if signals.get("variability_high") or signals.get("rework_loops", 0) > 0:
            recommendations.append(MethodologyRecommendation(
                methodology="Six Sigma DMAIC",
                score=0.85 if signals.get("rework_loops", 0) >= 2 else 0.6,
                rationale=(
                    "Hay rework loops o variabilidad — Six Sigma reduce variabilidad "
                    "y elimina defectos vía DMAIC."
                ),
                next_actions=[
                    "Define: Project Charter + SIPOC + CTQ",
                    "Measure: baseline de DPMO + Sigma actual",
                    "Analyze: Ishikawa + 5 Whys + FMEA",
                ],
                artifacts_to_produce=["Project Charter", "SIPOC", "Baseline metrics", "FMEA"],
            ))

        # Lean — waste detected
        if signals.get("muda_count", 0) >= 2 or signals.get("manual_task_ratio", 0) > 0.6:
            recommendations.append(MethodologyRecommendation(
                methodology="Lean / VSM",
                score=0.8,
                rationale="Mudas detectadas (desperdicios) + alta proporción manual — Lean es la prioridad",
                next_actions=[
                    "VSM end-to-end del proceso",
                    "Identificar 8 mudas por actividad",
                    "Diseñar TO-BE con eliminación de desperdicios",
                ],
                artifacts_to_produce=["VSM AS-IS", "Tabla de mudas", "VSM TO-BE"],
            ))

        # TOC — bottleneck
        if signals.get("bottleneck_detected") or signals.get("approval_chain", 0) >= 3:
            recommendations.append(MethodologyRecommendation(
                methodology="Teoría de Restricciones (TOC)",
                score=0.75,
                rationale="Cuello de botella sistémico — TOC focaliza la mejora donde más impacta",
                next_actions=[
                    "Identificar restricción principal (paso 1)",
                    "Explotar: maximizar uso sin inversión",
                    "Subordinar todo lo demás al ritmo del cuello",
                ],
                artifacts_to_produce=["Análisis de capacidad por estación", "Plan DBR"],
            ))

        # Kaizen Event for short-horizon
        timeframe = signals.get("timeframe_months", 6)
        if timeframe <= 3:
            recommendations.append(MethodologyRecommendation(
                methodology="Kaizen Event",
                score=0.6,
                rationale="Horizonte corto (<3 meses) — Kaizen Event de 3-5 días entrega resultados rápidos",
                next_actions=[
                    "Definir alcance del Kaizen (1 sub-proceso máximo)",
                    "Reunir equipo cross-funcional",
                    "Sprint de 3-5 días con prototipado",
                ],
                artifacts_to_produce=["Kaizen Newspaper", "Plan de implementación 30 días"],
            ))

        # A3 / 5 Whys when problem is unknown
        if not recommendations:
            recommendations.append(MethodologyRecommendation(
                methodology="A3 + 5 Whys",
                score=0.5,
                rationale="Sin señales claras — empezar con análisis de problema antes de elegir metodología pesada",
                next_actions=[
                    "Definir el problema en una sola frase",
                    "Aplicar 5 Whys para llegar a causa raíz",
                    "Documentar A3 (problema, análisis, contramedidas, plan)",
                ],
                artifacts_to_produce=["A3 Report"],
            ))

        # PDCA universal — siempre presente con score bajo
        recommendations.append(MethodologyRecommendation(
            methodology="PDCA",
            score=0.4,
            rationale="Ciclo universal de mejora continua aplicable como envoltorio",
            next_actions=["Plan", "Do (piloto)", "Check (medir)", "Act (estandarizar)"],
            artifacts_to_produce=["Plan PDCA"],
        ))

        # Sort by score descending
        recommendations.sort(key=lambda r: -r.score)
        return recommendations


def _manual_task_ratio(graph: ProcessGraph) -> float:
    from app.bpmn_intel.parser import NodeKind
    tasks = graph.tasks()
    if not tasks:
        return 0.0
    manual = sum(1 for t in tasks if t.kind in (NodeKind.MANUAL_TASK, NodeKind.USER_TASK))
    return manual / len(tasks)
