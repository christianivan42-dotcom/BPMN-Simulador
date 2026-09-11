"""
PathEnumerator — Enumerates routing paths through a ProcessGraph.

For quantitative analysis and simulation we need to know all possible paths
from Start to End, weighted by gateway probabilities.

Strategy:
    - DFS from each Start event to all End events
    - At exclusive gateways: branch (each path takes one outgoing flow)
    - At parallel gateways: treat as a sequence (all branches happen — represented
      as parallel sub-paths)
    - Cap maximum depth to avoid explosion in loop-y graphs

Output: list of RoutingPath where each is a sequence of node ids + estimated probability.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.bpmn_intel.parser import (
    GATEWAY_KINDS, NodeKind, ProcessGraph,
)


@dataclass
class RoutingPath:
    """A single routing path through the process."""
    sequence: list[str]  # node IDs from start to end
    probability: float   # 0..1, derived from gateway probabilities
    contains_loop: bool = False
    description: str = ""


@dataclass
class PathEnumerationResult:
    paths: list[RoutingPath] = field(default_factory=list)
    truncated: bool = False
    total_paths: int = 0


class PathEnumerator:
    """Enumerates routing paths with probability."""

    MAX_PATHS = 50
    MAX_DEPTH = 200

    @classmethod
    def enumerate(
        cls,
        graph: ProcessGraph,
        gateway_probs: dict[str, dict[str, float]] | None = None,
    ) -> PathEnumerationResult:
        """
        Enumerate paths from each start to each end.

        gateway_probs: optional override of probabilities at exclusive gateways.
            Format: { gateway_id: { flow_id: prob } }
            If not provided, exclusive gateways distribute uniformly.
        """
        result = PathEnumerationResult()
        gateway_probs = gateway_probs or {}

        for start in graph.start_events():
            cls._dfs(graph, start.id, [], 1.0, result, gateway_probs, depth=0)

        result.total_paths = len(result.paths)
        return result

    @classmethod
    def _dfs(
        cls,
        graph: ProcessGraph,
        node_id: str,
        path_so_far: list[str],
        prob_so_far: float,
        result: PathEnumerationResult,
        gateway_probs: dict[str, dict[str, float]],
        depth: int,
    ) -> None:
        if len(result.paths) >= cls.MAX_PATHS:
            result.truncated = True
            return
        if depth >= cls.MAX_DEPTH:
            result.truncated = True
            return

        # Loop detection: if we've already visited this node, mark as loop and stop
        contains_loop = node_id in path_so_far
        new_path = path_so_far + [node_id]

        node = graph.nodes.get(node_id)
        if node is None:
            return

        # End event → complete the path
        if node.kind == NodeKind.END_EVENT:
            result.paths.append(RoutingPath(
                sequence=new_path,
                probability=prob_so_far,
                contains_loop=contains_loop,
                description=cls._describe(graph, new_path),
            ))
            return

        # If loop and we're in it, stop to avoid infinite recursion
        if contains_loop:
            result.paths.append(RoutingPath(
                sequence=new_path,
                probability=prob_so_far,
                contains_loop=True,
                description=cls._describe(graph, new_path) + " [LOOP]",
            ))
            return

        outgoing = graph.outgoing(node_id)
        if not outgoing:
            # Dead end — record as incomplete path
            result.paths.append(RoutingPath(
                sequence=new_path,
                probability=prob_so_far,
                description=cls._describe(graph, new_path) + " [INCOMPLETE]",
            ))
            return

        # Distribute probability across outgoing flows
        if node.kind == NodeKind.EXCLUSIVE_GATEWAY:
            # Each branch is mutually exclusive
            custom = gateway_probs.get(node_id, {})
            n_out = len(outgoing)
            for flow in outgoing:
                flow_prob = custom.get(flow.id, 1.0 / n_out)
                cls._dfs(graph, flow.target_id, new_path, prob_so_far * flow_prob,
                         result, gateway_probs, depth + 1)
        elif node.kind == NodeKind.PARALLEL_GATEWAY:
            # All branches happen — treat as following each independently with prob 1.0
            # (in real simulation we'd need to model fork/join properly; here we just
            # follow the first to enumerate path structure)
            for flow in outgoing:
                cls._dfs(graph, flow.target_id, new_path, prob_so_far,
                         result, gateway_probs, depth + 1)
        elif node.kind == NodeKind.INCLUSIVE_GATEWAY:
            # Conditional - treat like exclusive for enumeration
            n_out = len(outgoing)
            for flow in outgoing:
                cls._dfs(graph, flow.target_id, new_path, prob_so_far * (1.0 / n_out),
                         result, gateway_probs, depth + 1)
        else:
            # Single outgoing usually, but handle multiple by taking all
            for flow in outgoing:
                cls._dfs(graph, flow.target_id, new_path, prob_so_far,
                         result, gateway_probs, depth + 1)

    @staticmethod
    def _describe(graph: ProcessGraph, path: list[str]) -> str:
        names = []
        for nid in path:
            n = graph.nodes.get(nid)
            if n:
                names.append(n.name or n.id)
        return " → ".join(names)
