"""
BpmnAnalyzer — Pattern detection on a ProcessGraph.

Detects:
    - Loops (cycles in the directed graph)
    - Dead ends (nodes with no outgoing flow that are not End events)
    - Unreachable nodes (no path from any Start)
    - Disconnected gateways (incoming branches != outgoing branches for parallel)
    - Redundant tasks (same name appearing multiple times in series)
    - Approval chains (sequence of user tasks that may indicate over-control)
    - Long sequential chains (>= N tasks without branching → automation candidates)
    - Boundary errors (start has no outgoing, end has no incoming, etc.)
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from app.bpmn_intel.parser import (
    EVENT_KINDS, GATEWAY_KINDS, TASK_KINDS,
    BpmnNode, NodeKind, ProcessGraph,
)


@dataclass
class AnalysisFinding:
    code: str           # e.g. "loop_detected"
    severity: str       # info | warning | error
    title: str
    detail: str
    affected_nodes: list[str] = field(default_factory=list)
    recommendation: str | None = None


class BpmnAnalyzer:
    """Stateless analyzer."""

    @staticmethod
    def analyze(graph: ProcessGraph) -> dict[str, Any]:
        findings: list[AnalysisFinding] = []
        findings.extend(BpmnAnalyzer.detect_loops(graph))
        findings.extend(BpmnAnalyzer.detect_dead_ends(graph))
        findings.extend(BpmnAnalyzer.detect_unreachable(graph))
        findings.extend(BpmnAnalyzer.detect_boundary_issues(graph))
        findings.extend(BpmnAnalyzer.detect_redundant_tasks(graph))
        findings.extend(BpmnAnalyzer.detect_long_sequential_chains(graph))
        findings.extend(BpmnAnalyzer.detect_approval_chains(graph))
        findings.extend(BpmnAnalyzer.detect_unbalanced_parallel_gateways(graph))

        return {
            "stats": graph.stats(),
            "findings": [_finding_to_dict(f) for f in findings],
            "severity_counts": _count_by_severity(findings),
        }

    # ── Individual detectors ──────────────────────────────────────────────────

    @staticmethod
    def detect_loops(graph: ProcessGraph) -> list[AnalysisFinding]:
        """DFS-based cycle detection."""
        visited: set[str] = set()
        rec_stack: set[str] = set()
        cycles: list[list[str]] = []

        def dfs(node_id: str, path: list[str]) -> None:
            visited.add(node_id)
            rec_stack.add(node_id)
            path.append(node_id)
            for flow in graph.outgoing(node_id):
                tgt = flow.target_id
                if tgt not in visited:
                    dfs(tgt, list(path))
                elif tgt in rec_stack:
                    # Found a cycle — record the part of the path from tgt to end
                    if tgt in path:
                        idx = path.index(tgt)
                        cycles.append(path[idx:] + [tgt])
            rec_stack.discard(node_id)

        for start in graph.start_events():
            if start.id not in visited:
                dfs(start.id, [])
        # Also check nodes not reachable from start
        for node_id in graph.nodes:
            if node_id not in visited:
                dfs(node_id, [])

        findings: list[AnalysisFinding] = []
        for cycle in cycles[:10]:  # cap at 10
            names = [graph.nodes[n].name or n for n in cycle if n in graph.nodes]
            findings.append(AnalysisFinding(
                code="loop_detected",
                severity="warning",
                title="Loop / Rework Cycle detectado",
                detail=f"Ciclo: {' → '.join(names)}",
                affected_nodes=cycle,
                recommendation=(
                    "Revisar si el rework está controlado (contador máximo, condiciones de salida). "
                    "Loops sin control son fuente de desperdicio (muda de defectos)."
                ),
            ))
        return findings

    @staticmethod
    def detect_dead_ends(graph: ProcessGraph) -> list[AnalysisFinding]:
        """Nodes with no outgoing flow that are not End events."""
        findings = []
        for node in graph.nodes.values():
            if node.kind == NodeKind.END_EVENT:
                continue
            if not graph.outgoing(node.id):
                findings.append(AnalysisFinding(
                    code="dead_end",
                    severity="error",
                    title="Nodo sin salida",
                    detail=f"'{node.name or node.id}' ({node.kind.value}) no tiene flujo de salida.",
                    affected_nodes=[node.id],
                    recommendation="Conectar a un End Event o a la siguiente actividad.",
                ))
        return findings

    @staticmethod
    def detect_unreachable(graph: ProcessGraph) -> list[AnalysisFinding]:
        """Nodes not reachable from any start event."""
        reachable: set[str] = set()
        queue = deque(n.id for n in graph.start_events())
        while queue:
            cur = queue.popleft()
            if cur in reachable:
                continue
            reachable.add(cur)
            for f in graph.outgoing(cur):
                queue.append(f.target_id)
        findings = []
        for node in graph.nodes.values():
            if node.kind == NodeKind.START_EVENT:
                continue
            if node.id not in reachable:
                findings.append(AnalysisFinding(
                    code="unreachable",
                    severity="error",
                    title="Nodo inalcanzable",
                    detail=f"'{node.name or node.id}' no es alcanzable desde ningún Start Event.",
                    affected_nodes=[node.id],
                    recommendation="Conectar este nodo al flujo principal o eliminarlo.",
                ))
        return findings

    @staticmethod
    def detect_boundary_issues(graph: ProcessGraph) -> list[AnalysisFinding]:
        findings = []
        if not graph.start_events():
            findings.append(AnalysisFinding(
                code="no_start_event", severity="error",
                title="Proceso sin Start Event",
                detail="El proceso BPMN no tiene ningún Start Event.",
                recommendation="Añadir un Start Event al inicio del flujo.",
            ))
        if not graph.end_events():
            findings.append(AnalysisFinding(
                code="no_end_event", severity="error",
                title="Proceso sin End Event",
                detail="El proceso BPMN no tiene ningún End Event.",
                recommendation="Añadir al menos un End Event de salida.",
            ))
        for start in graph.start_events():
            if graph.incoming(start.id):
                findings.append(AnalysisFinding(
                    code="start_has_incoming", severity="warning",
                    title="Start Event con entrada",
                    detail=f"El Start Event '{start.name or start.id}' tiene flujos entrantes.",
                    affected_nodes=[start.id],
                ))
        for end in graph.end_events():
            if graph.outgoing(end.id):
                findings.append(AnalysisFinding(
                    code="end_has_outgoing", severity="warning",
                    title="End Event con salida",
                    detail=f"El End Event '{end.name or end.id}' tiene flujos salientes.",
                    affected_nodes=[end.id],
                ))
        return findings

    @staticmethod
    def detect_redundant_tasks(graph: ProcessGraph) -> list[AnalysisFinding]:
        """Tasks with identical names appearing multiple times (case-insensitive)."""
        by_name: dict[str, list[BpmnNode]] = defaultdict(list)
        for node in graph.tasks():
            if not node.name.strip():
                continue
            by_name[node.name.lower().strip()].append(node)
        findings = []
        for name, nodes in by_name.items():
            if len(nodes) >= 2:
                findings.append(AnalysisFinding(
                    code="redundant_task_name",
                    severity="info",
                    title=f"Tareas duplicadas: '{nodes[0].name}'",
                    detail=f"Existen {len(nodes)} tareas con el mismo nombre — verificar si es redundancia.",
                    affected_nodes=[n.id for n in nodes],
                    recommendation="Si son la misma actividad, consolidar. Si son distintas, diferenciar nombres.",
                ))
        return findings

    @staticmethod
    def detect_long_sequential_chains(graph: ProcessGraph, min_length: int = 5) -> list[AnalysisFinding]:
        """Sequential chains of tasks without branching — candidates for automation."""
        findings = []
        # Find chains starting from a task with single predecessor (non-task) or start
        visited_chain: set[str] = set()
        for node in graph.tasks():
            if node.id in visited_chain:
                continue
            chain = [node.id]
            cur = node
            while True:
                outs = graph.outgoing(cur.id)
                if len(outs) != 1:
                    break
                next_node = graph.nodes.get(outs[0].target_id)
                if next_node is None or next_node.kind not in TASK_KINDS:
                    break
                # ensure only one incoming flow into next_node
                if len(graph.incoming(next_node.id)) != 1:
                    break
                chain.append(next_node.id)
                cur = next_node
            if len(chain) >= min_length:
                visited_chain.update(chain)
                names = [graph.nodes[n].name or n for n in chain]
                findings.append(AnalysisFinding(
                    code="long_sequential_chain",
                    severity="info",
                    title=f"Cadena secuencial larga ({len(chain)} tareas)",
                    detail=f"Cadena: {' → '.join(names[:5])}{'…' if len(names) > 5 else ''}",
                    affected_nodes=chain,
                    recommendation=(
                        "Candidato a automatización RPA/BPMS o consolidación. "
                        "Evaluar si todas las actividades agregan valor (VAR)."
                    ),
                ))
        return findings

    @staticmethod
    def detect_approval_chains(graph: ProcessGraph, min_approvals: int = 3) -> list[AnalysisFinding]:
        """N userTasks in a row with names suggesting approval = potential over-control."""
        APPROVAL_TERMS = ("aprob", "autoriz", "valid", "revis", "verifi", "confirm")
        findings = []
        for start in graph.tasks():
            chain: list[BpmnNode] = []
            cur = start
            while cur and cur.kind in TASK_KINDS:
                if any(t in (cur.name or "").lower() for t in APPROVAL_TERMS):
                    chain.append(cur)
                    outs = graph.outgoing(cur.id)
                    if len(outs) != 1:
                        break
                    nxt = graph.nodes.get(outs[0].target_id)
                    if nxt is None or nxt.kind not in TASK_KINDS:
                        break
                    cur = nxt
                else:
                    break
            if len(chain) >= min_approvals:
                findings.append(AnalysisFinding(
                    code="approval_chain",
                    severity="warning",
                    title=f"Cadena de aprobaciones ({len(chain)})",
                    detail=f"{' → '.join(n.name or n.id for n in chain)}",
                    affected_nodes=[n.id for n in chain],
                    recommendation=(
                        "Cadenas largas de aprobaciones son síntoma de sobre-control. "
                        "Evaluar: ¿se puede consolidar en una sola aprobación? ¿automatizar reglas?"
                    ),
                ))
        return findings

    @staticmethod
    def detect_unbalanced_parallel_gateways(graph: ProcessGraph) -> list[AnalysisFinding]:
        """Parallel split gateways without matching join."""
        splits = []
        joins = []
        for gw in graph.gateways():
            if gw.kind != NodeKind.PARALLEL_GATEWAY:
                continue
            outs = len(graph.outgoing(gw.id))
            ins = len(graph.incoming(gw.id))
            if outs > 1 and ins == 1:
                splits.append(gw)
            elif ins > 1 and outs == 1:
                joins.append(gw)
        findings = []
        if len(splits) != len(joins):
            findings.append(AnalysisFinding(
                code="unbalanced_parallel",
                severity="warning",
                title="Gateways paralelos desbalanceados",
                detail=f"Splits paralelos: {len(splits)} | Joins paralelos: {len(joins)}. Deben coincidir.",
                affected_nodes=[g.id for g in splits + joins],
                recommendation="Asegurar que cada split paralelo tenga su join correspondiente.",
            ))
        return findings


# ── Helpers ──────────────────────────────────────────────────────────────────

def _finding_to_dict(f: AnalysisFinding) -> dict[str, Any]:
    return {
        "code": f.code,
        "severity": f.severity,
        "title": f.title,
        "detail": f.detail,
        "affected_nodes": f.affected_nodes,
        "recommendation": f.recommendation,
    }


def _count_by_severity(findings: list[AnalysisFinding]) -> dict[str, int]:
    counts = {"info": 0, "warning": 0, "error": 0}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    return counts
