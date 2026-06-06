"""
Theory of Constraints (Goldratt) — 5 Focusing Steps.

Used when the process has a systemic bottleneck that limits overall throughput.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.bpmn_intel.parser import ProcessGraph
from app.simulation.monte_carlo import MonteCarloSimulator, SimulationConfig, SimulationResult


@dataclass
class TocStep:
    number: int
    name: str
    objective: str
    actions: list[str]


TOC_5_STEPS: list[TocStep] = [
    TocStep(1, "Identificar la restricción",
            objective="Encontrar el cuello de botella del sistema (limita el throughput)",
            actions=["Observar dónde se acumula trabajo (WIP)",
                     "Medir capacidad por estación",
                     "Identificar la estación con menor throughput"]),
    TocStep(2, "Explotar la restricción",
            objective="Maximizar el uso de la restricción sin inversión",
            actions=["Eliminar tiempos muertos en la restricción",
                     "Asegurar suministro continuo al cuello de botella",
                     "Eliminar interrupciones",
                     "Reasignar trabajo no-crítico fuera del cuello"]),
    TocStep(3, "Subordinar todo lo demás",
            objective="Las demás actividades trabajan al ritmo de la restricción",
            actions=["No producir más rápido que lo que la restricción procesa",
                     "Sincronizar (DBR: Drum-Buffer-Rope)",
                     "Eliminar over-production aguas arriba"]),
    TocStep(4, "Elevar la restricción",
            objective="Si los pasos 2-3 no son suficientes, aumentar capacidad",
            actions=["Inversión: más servidores / equipo",
                     "Automatización",
                     "Tercerización",
                     "Rediseño tecnológico"]),
    TocStep(5, "Volver al paso 1",
            objective="Nueva restricción ahora — repetir el ciclo",
            actions=["Buscar la nueva restricción",
                     "Evitar inercia (la solución anterior no se vuelve política)"]),
]


@dataclass
class TocAnalysisResult:
    constraint_candidates: list[dict[str, Any]]  # nodes with highest utilization
    recommendation: str
    next_step: str


class TocMethodology:
    """TOC analysis on a ProcessGraph."""

    @staticmethod
    def framework() -> list[TocStep]:
        return TOC_5_STEPS

    @staticmethod
    def identify_constraints(
        graph: ProcessGraph,
        sim_result: SimulationResult | None = None,
    ) -> TocAnalysisResult:
        """
        Identify constraint candidates.
        Strategy:
          - If simulation result provided: use node_total_time (highest = bottleneck)
          - Else: use heuristics (approval tasks, manual tasks, high in-degree)
        """
        candidates: list[dict[str, Any]] = []

        if sim_result and sim_result.node_total_time:
            # Sort nodes by total simulated time (proxy for utilization)
            sorted_nodes = sorted(
                sim_result.node_total_time.items(),
                key=lambda kv: -kv[1],
            )[:5]
            for nid, total_time in sorted_nodes:
                node = graph.nodes.get(nid)
                if node is None:
                    continue
                avg = total_time / max(sim_result.completed_iterations, 1)
                candidates.append({
                    "node_id": nid,
                    "name": node.name or nid,
                    "kind": node.kind.value,
                    "total_time": round(total_time, 2),
                    "avg_time_per_case": round(avg, 2),
                    "reason": "Tiempo total agregado más alto en simulación",
                })
        else:
            # Heuristic: tasks with many incoming flows or high name affinity to bottlenecks
            slow_terms = ("aprob", "revis", "valid", "espera", "queue", "verifi", "audit")
            for task in graph.tasks():
                score = 0
                reason_parts: list[str] = []
                # Many incoming = converging point
                in_count = len(graph.incoming(task.id))
                if in_count >= 2:
                    score += 2
                    reason_parts.append(f"converge {in_count} flujos")
                # Name suggests slow activity
                if any(t in (task.name or "").lower() for t in slow_terms):
                    score += 2
                    reason_parts.append("nombre sugiere actividad lenta/control")
                if score >= 2:
                    candidates.append({
                        "node_id": task.id,
                        "name": task.name or task.id,
                        "kind": task.kind.value,
                        "score": score,
                        "reason": "; ".join(reason_parts) or "candidato",
                    })
            candidates.sort(key=lambda c: -c.get("score", 0))
            candidates = candidates[:5]

        if not candidates:
            return TocAnalysisResult(
                constraint_candidates=[],
                recommendation="No se identificaron restricciones claras con la información disponible",
                next_step="Recolectar datos de tiempos reales por actividad y volver a analizar",
            )

        return TocAnalysisResult(
            constraint_candidates=candidates,
            recommendation=(
                f"Posible restricción principal: '{candidates[0]['name']}'. "
                f"Aplicar pasos 2-3 (Explotar + Subordinar) antes de inversión (paso 4)."
            ),
            next_step="Step 2: Explotar la restricción identificada (eliminar tiempos muertos)",
        )
