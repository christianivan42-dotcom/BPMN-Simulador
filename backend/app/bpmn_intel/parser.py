"""
BpmnParser — Parses BPMN 2.0 XML into a ProcessGraph.

Uses regex (consistent with the rest of the codebase) to handle namespace prefixes
robustly (bpmn:, bpmn2:, or no prefix). Builds a navigable structure agents can reason on.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class NodeKind(StrEnum):
    """BPMN node kinds we care about."""
    START_EVENT = "startEvent"
    END_EVENT = "endEvent"
    INTERMEDIATE_CATCH = "intermediateCatchEvent"
    INTERMEDIATE_THROW = "intermediateThrowEvent"
    BOUNDARY = "boundaryEvent"
    TASK = "task"
    USER_TASK = "userTask"
    SERVICE_TASK = "serviceTask"
    MANUAL_TASK = "manualTask"
    SCRIPT_TASK = "scriptTask"
    SEND_TASK = "sendTask"
    RECEIVE_TASK = "receiveTask"
    BUSINESS_RULE_TASK = "businessRuleTask"
    SUBPROCESS = "subProcess"
    CALL_ACTIVITY = "callActivity"
    EXCLUSIVE_GATEWAY = "exclusiveGateway"
    PARALLEL_GATEWAY = "parallelGateway"
    INCLUSIVE_GATEWAY = "inclusiveGateway"
    EVENT_BASED_GATEWAY = "eventBasedGateway"
    UNKNOWN = "unknown"


class GatewayKind(StrEnum):
    EXCLUSIVE = "exclusive"
    PARALLEL = "parallel"
    INCLUSIVE = "inclusive"
    EVENT_BASED = "event_based"


# Mapeo de qué consideramos cada tipo
TASK_KINDS = {
    NodeKind.TASK, NodeKind.USER_TASK, NodeKind.SERVICE_TASK, NodeKind.MANUAL_TASK,
    NodeKind.SCRIPT_TASK, NodeKind.SEND_TASK, NodeKind.RECEIVE_TASK,
    NodeKind.BUSINESS_RULE_TASK,
}
EVENT_KINDS = {
    NodeKind.START_EVENT, NodeKind.END_EVENT,
    NodeKind.INTERMEDIATE_CATCH, NodeKind.INTERMEDIATE_THROW, NodeKind.BOUNDARY,
}
GATEWAY_KINDS = {
    NodeKind.EXCLUSIVE_GATEWAY, NodeKind.PARALLEL_GATEWAY,
    NodeKind.INCLUSIVE_GATEWAY, NodeKind.EVENT_BASED_GATEWAY,
}


@dataclass
class BpmnNode:
    """A node in the process graph."""
    id: str
    kind: NodeKind
    name: str
    properties: dict[str, Any] = field(default_factory=dict)
    lane_id: str | None = None
    pool_id: str | None = None


@dataclass
class BpmnFlow:
    """A sequence flow / message flow between two nodes."""
    id: str
    source_id: str
    target_id: str
    name: str = ""
    condition: str | None = None  # condition expression for conditional flows
    is_default: bool = False


@dataclass
class BpmnLane:
    id: str
    name: str
    pool_id: str | None = None
    nodes: list[str] = field(default_factory=list)  # node ids in this lane


@dataclass
class BpmnPool:
    id: str
    name: str
    lanes: list[str] = field(default_factory=list)  # lane ids


@dataclass
class ProcessGraph:
    """In-memory representation of a parsed BPMN process."""
    process_id: str
    process_name: str
    nodes: dict[str, BpmnNode] = field(default_factory=dict)
    flows: list[BpmnFlow] = field(default_factory=list)
    lanes: dict[str, BpmnLane] = field(default_factory=dict)
    pools: dict[str, BpmnPool] = field(default_factory=dict)

    # ── Convenience accessors ─────────────────────────────────────────────────

    def outgoing(self, node_id: str) -> list[BpmnFlow]:
        return [f for f in self.flows if f.source_id == node_id]

    def incoming(self, node_id: str) -> list[BpmnFlow]:
        return [f for f in self.flows if f.target_id == node_id]

    def successors(self, node_id: str) -> list[BpmnNode]:
        return [self.nodes[f.target_id] for f in self.outgoing(node_id) if f.target_id in self.nodes]

    def predecessors(self, node_id: str) -> list[BpmnNode]:
        return [self.nodes[f.source_id] for f in self.incoming(node_id) if f.source_id in self.nodes]

    def start_events(self) -> list[BpmnNode]:
        return [n for n in self.nodes.values() if n.kind == NodeKind.START_EVENT]

    def end_events(self) -> list[BpmnNode]:
        return [n for n in self.nodes.values() if n.kind == NodeKind.END_EVENT]

    def tasks(self) -> list[BpmnNode]:
        return [n for n in self.nodes.values() if n.kind in TASK_KINDS]

    def gateways(self) -> list[BpmnNode]:
        return [n for n in self.nodes.values() if n.kind in GATEWAY_KINDS]

    def stats(self) -> dict[str, int]:
        return {
            "total_nodes": len(self.nodes),
            "total_flows": len(self.flows),
            "tasks": len(self.tasks()),
            "gateways": len(self.gateways()),
            "events": sum(1 for n in self.nodes.values() if n.kind in EVENT_KINDS),
            "lanes": len(self.lanes),
            "pools": len(self.pools),
            "start_events": len(self.start_events()),
            "end_events": len(self.end_events()),
        }


# ── Parser ───────────────────────────────────────────────────────────────────


# Regex: open + close tag with content, captures attrs and inner XML
_NODE_PATTERNS = {
    NodeKind.START_EVENT:        r"startEvent",
    NodeKind.END_EVENT:          r"endEvent",
    NodeKind.INTERMEDIATE_CATCH: r"intermediateCatchEvent",
    NodeKind.INTERMEDIATE_THROW: r"intermediateThrowEvent",
    NodeKind.BOUNDARY:           r"boundaryEvent",
    NodeKind.USER_TASK:          r"userTask",
    NodeKind.SERVICE_TASK:       r"serviceTask",
    NodeKind.MANUAL_TASK:        r"manualTask",
    NodeKind.SCRIPT_TASK:        r"scriptTask",
    NodeKind.SEND_TASK:          r"sendTask",
    NodeKind.RECEIVE_TASK:       r"receiveTask",
    NodeKind.BUSINESS_RULE_TASK: r"businessRuleTask",
    NodeKind.TASK:               r"task",
    NodeKind.SUBPROCESS:         r"subProcess",
    NodeKind.CALL_ACTIVITY:      r"callActivity",
    NodeKind.EXCLUSIVE_GATEWAY:  r"exclusiveGateway",
    NodeKind.PARALLEL_GATEWAY:   r"parallelGateway",
    NodeKind.INCLUSIVE_GATEWAY:  r"inclusiveGateway",
    NodeKind.EVENT_BASED_GATEWAY: r"eventBasedGateway",
}


def _ns_prefix() -> str:
    """Regex fragment: optional bpmn / bpmn2 namespace prefix."""
    return r"(?:bpmn2?:)?"


class BpmnParser:
    """Parses BPMN 2.0 XML into a ProcessGraph."""

    @staticmethod
    def parse(xml: str) -> ProcessGraph:
        if not xml or "<" not in xml:
            return ProcessGraph(process_id="empty", process_name="(vacío)")

        # Extract process definition
        proc_pattern = re.compile(
            rf"<{_ns_prefix()}process\b([^>]*)>",
            re.IGNORECASE,
        )
        m = proc_pattern.search(xml)
        if m:
            attrs = m.group(1)
            process_id = _attr(attrs, "id") or "Process_1"
            process_name = _attr(attrs, "name") or process_id
        else:
            process_id = "Process_1"
            process_name = "Proceso"

        graph = ProcessGraph(process_id=process_id, process_name=process_name)

        # 1. Parse nodes (tasks, events, gateways, subprocesses)
        # Order matters: try most specific kinds first (userTask before task, etc.)
        ordered = [
            NodeKind.USER_TASK, NodeKind.SERVICE_TASK, NodeKind.MANUAL_TASK,
            NodeKind.SCRIPT_TASK, NodeKind.SEND_TASK, NodeKind.RECEIVE_TASK,
            NodeKind.BUSINESS_RULE_TASK,
            NodeKind.START_EVENT, NodeKind.END_EVENT,
            NodeKind.INTERMEDIATE_CATCH, NodeKind.INTERMEDIATE_THROW, NodeKind.BOUNDARY,
            NodeKind.EXCLUSIVE_GATEWAY, NodeKind.PARALLEL_GATEWAY,
            NodeKind.INCLUSIVE_GATEWAY, NodeKind.EVENT_BASED_GATEWAY,
            NodeKind.SUBPROCESS, NodeKind.CALL_ACTIVITY,
            NodeKind.TASK,  # last - generic task
        ]
        seen_ids: set[str] = set()
        for kind in ordered:
            tag = _NODE_PATTERNS[kind]
            # Both self-closing and open tags
            pattern = re.compile(
                rf"<{_ns_prefix()}{tag}\b([^>]*?)(?:/>|>(.*?)</{_ns_prefix()}{tag}>)",
                re.IGNORECASE | re.DOTALL,
            )
            for match in pattern.finditer(xml):
                attrs = match.group(1)
                node_id = _attr(attrs, "id")
                if not node_id or node_id in seen_ids:
                    continue
                seen_ids.add(node_id)
                node_name = _attr(attrs, "name") or ""
                inner = match.group(2) or ""
                # Detect event subtypes (timer, message, signal) for events
                props: dict[str, Any] = {}
                if kind in EVENT_KINDS:
                    for evt_marker in ("timerEventDefinition", "messageEventDefinition",
                                       "signalEventDefinition", "errorEventDefinition",
                                       "cancelEventDefinition", "compensateEventDefinition"):
                        if evt_marker.lower() in inner.lower():
                            props["event_definition"] = evt_marker.replace("EventDefinition", "").lower()
                            break
                graph.nodes[node_id] = BpmnNode(
                    id=node_id, kind=kind, name=node_name, properties=props,
                )

        # 2. Parse sequence flows
        flow_pattern = re.compile(
            rf"<{_ns_prefix()}sequenceFlow\b([^>]*?)(?:/>|>(.*?)</{_ns_prefix()}sequenceFlow>)",
            re.IGNORECASE | re.DOTALL,
        )
        for match in flow_pattern.finditer(xml):
            attrs = match.group(1)
            flow_id = _attr(attrs, "id")
            source_id = _attr(attrs, "sourceRef")
            target_id = _attr(attrs, "targetRef")
            if not (flow_id and source_id and target_id):
                continue
            name = _attr(attrs, "name") or ""
            inner = match.group(2) or ""
            # Conditional expression
            cond_match = re.search(
                rf"<{_ns_prefix()}conditionExpression\b[^>]*>(.*?)</{_ns_prefix()}conditionExpression>",
                inner, re.IGNORECASE | re.DOTALL,
            )
            condition = cond_match.group(1).strip() if cond_match else None
            graph.flows.append(BpmnFlow(
                id=flow_id, source_id=source_id, target_id=target_id,
                name=name, condition=condition,
            ))

        # 3. Parse lanes
        lane_pattern = re.compile(
            rf"<{_ns_prefix()}lane\b([^>]*?)(?:/>|>(.*?)</{_ns_prefix()}lane>)",
            re.IGNORECASE | re.DOTALL,
        )
        for match in lane_pattern.finditer(xml):
            attrs = match.group(1)
            lane_id = _attr(attrs, "id")
            if not lane_id:
                continue
            lane_name = _attr(attrs, "name") or ""
            inner = match.group(2) or ""
            # flowNodeRef IDs inside the lane
            refs = re.findall(
                rf"<{_ns_prefix()}flowNodeRef[^>]*>(.*?)</{_ns_prefix()}flowNodeRef>",
                inner, re.IGNORECASE | re.DOTALL,
            )
            graph.lanes[lane_id] = BpmnLane(
                id=lane_id, name=lane_name, nodes=[r.strip() for r in refs],
            )
            # Tag nodes with lane
            for node_id in [r.strip() for r in refs]:
                if node_id in graph.nodes:
                    graph.nodes[node_id].lane_id = lane_id

        return graph


def _attr(attrs: str, name: str) -> str | None:
    """Extract attribute value from a tag's attribute string."""
    m = re.search(rf'\b{name}\s*=\s*"([^"]*)"', attrs)
    return m.group(1) if m else None
