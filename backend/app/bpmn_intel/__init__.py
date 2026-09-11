"""
BPMN Intelligence Module — BPMN 2.0 as a living cognitive object.

Architecture:
    - BpmnParser: XML → structured ProcessGraph
    - ProcessGraph: in-memory graph (nodes + flows + lanes + pools)
    - BpmnAnalyzer: pattern detection (loops, parallel paths, dead-ends, redundancy)
    - PathEnumerator: enumerates routing paths through gateways
    - BpmnMutator: programmatic modifications (add/remove/reroute)
    - BpmnSerializer: ProcessGraph → BPMN 2.0 XML

The agents (BpmnInterpreter, BpmnAnalyzer, Quantitative, Lean/SixSigma/TOC, ToBeRedesign)
operate on these structures.
"""
from app.bpmn_intel.parser import (
    BpmnParser, ProcessGraph, BpmnNode, BpmnFlow, NodeKind, GatewayKind,
)
from app.bpmn_intel.analyzer import BpmnAnalyzer, AnalysisFinding
from app.bpmn_intel.paths import PathEnumerator, RoutingPath
__all__ = [
    "BpmnParser", "ProcessGraph", "BpmnNode", "BpmnFlow", "NodeKind", "GatewayKind",
    "BpmnAnalyzer", "AnalysisFinding",
    "PathEnumerator", "RoutingPath",
]
