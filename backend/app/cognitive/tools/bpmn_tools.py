"""
BPMN-specific cognitive tools.

Registered into TOOL_REGISTRY at import. These let agents:
    - Parse and analyze BPMN XML
    - Detect patterns (loops, redundancies, approval chains)
    - Enumerate routing paths
    - Run Monte Carlo simulations
    - Compute M/M/c queue metrics
    - Generate TO-BE proposals
"""
from __future__ import annotations

from typing import Any

from app.bpmn_intel.analyzer import BpmnAnalyzer
from app.bpmn_intel.parser import BpmnParser
from app.bpmn_intel.paths import PathEnumerator
from app.cognitive.tools.registry import TOOL_REGISTRY, Tool
from app.methodologies.lean import LeanMethodology
from app.methodologies.selector import MethodologySelector
from app.methodologies.six_sigma import SixSigmaMethodology
from app.methodologies.toc import TocMethodology
from app.simulation.monte_carlo import MonteCarloSimulator, SimulationConfig
from app.simulation.queue_theory import MMcQueueAnalyzer


# ── BPMN parsing & analysis ──────────────────────────────────────────────────

def _tool_bpmn_parse(args: dict[str, Any], ctx) -> dict[str, Any]:
    xml = args.get("xml", "")
    if not xml:
        return {"error": "xml required"}
    graph = BpmnParser.parse(xml)
    return {
        "process_id": graph.process_id,
        "process_name": graph.process_name,
        "stats": graph.stats(),
        "nodes": [
            {"id": n.id, "kind": n.kind.value, "name": n.name}
            for n in graph.nodes.values()
        ],
        "flows": [
            {"id": f.id, "source": f.source_id, "target": f.target_id, "name": f.name}
            for f in graph.flows
        ],
    }


def _tool_bpmn_analyze(args: dict[str, Any], ctx) -> dict[str, Any]:
    xml = args.get("xml", "")
    if not xml:
        return {"error": "xml required"}
    graph = BpmnParser.parse(xml)
    return BpmnAnalyzer.analyze(graph)


def _tool_bpmn_paths(args: dict[str, Any], ctx) -> dict[str, Any]:
    xml = args.get("xml", "")
    gateway_probs = args.get("gateway_probs") or {}
    if not xml:
        return {"error": "xml required"}
    graph = BpmnParser.parse(xml)
    result = PathEnumerator.enumerate(graph, gateway_probs=gateway_probs)
    return {
        "total_paths": result.total_paths,
        "truncated": result.truncated,
        "paths": [
            {
                "probability": round(p.probability, 4),
                "description": p.description,
                "sequence": p.sequence,
                "contains_loop": p.contains_loop,
            }
            for p in result.paths
        ],
    }


# ── Lean / Six Sigma / TOC ───────────────────────────────────────────────────

def _tool_lean_mudas(args: dict[str, Any], ctx) -> dict[str, Any]:
    xml = args.get("xml", "")
    if not xml:
        return {"error": "xml required"}
    graph = BpmnParser.parse(xml)
    mudas = LeanMethodology.detect_mudas(graph)
    return {
        "muda_count": len(mudas),
        "mudas": [
            {
                "type": m.type.value,
                "description": m.description,
                "severity": m.severity,
                "affected_nodes": m.affected_nodes,
                "recommendation": m.recommendation,
            }
            for m in mudas
        ],
        "applicability": LeanMethodology.applicability_score(graph),
    }


def _tool_sixsigma_dpmo(args: dict[str, Any], ctx) -> dict[str, Any]:
    defects = int(args.get("defects", 0))
    opportunities = int(args.get("opportunities", 1))
    units = int(args.get("units", 1))
    dpmo = SixSigmaMethodology.dpmo(defects, opportunities, units)
    sigma = SixSigmaMethodology.sigma_level(dpmo)
    yield_pct = SixSigmaMethodology.yield_from_dpmo(dpmo) * 100
    return {
        "defects": defects,
        "opportunities_per_unit": opportunities,
        "units": units,
        "dpmo": round(dpmo, 2),
        "sigma_level": sigma,
        "yield_pct": round(yield_pct, 4),
    }


def _tool_toc_constraints(args: dict[str, Any], ctx) -> dict[str, Any]:
    xml = args.get("xml", "")
    if not xml:
        return {"error": "xml required"}
    graph = BpmnParser.parse(xml)
    result = TocMethodology.identify_constraints(graph)
    return {
        "candidates": result.constraint_candidates,
        "recommendation": result.recommendation,
        "next_step": result.next_step,
        "framework": [
            {"step": s.number, "name": s.name, "objective": s.objective}
            for s in TocMethodology.framework()
        ],
    }


# ── Simulation ───────────────────────────────────────────────────────────────

def _tool_bpmn_simulate(args: dict[str, Any], ctx) -> dict[str, Any]:
    xml = args.get("xml", "")
    iterations = int(args.get("iterations", 1000))
    default_mean = float(args.get("default_task_mean", 5.0))
    default_stdev = float(args.get("default_task_stdev", 2.0))
    gateway_probs = args.get("gateway_probs") or {}
    timings_input = args.get("timings") or {}

    if not xml:
        return {"error": "xml required"}
    graph = BpmnParser.parse(xml)
    if not graph.start_events():
        return {"error": "BPMN sin Start Event — no se puede simular"}

    # Build NodeTimingProfile from input
    from app.simulation.monte_carlo import NodeTimingProfile, TimingDistribution
    timings: dict[str, NodeTimingProfile] = {}
    for node_id, profile in timings_input.items():
        timings[node_id] = NodeTimingProfile(
            node_id=node_id,
            mean=float(profile.get("mean", default_mean)),
            stdev=float(profile.get("stdev", default_stdev)),
            distribution=TimingDistribution(profile.get("distribution", "normal")),
        )

    config = SimulationConfig(
        iterations=iterations,
        default_task_mean=default_mean,
        default_task_stdev=default_stdev,
        timings=timings,
        gateway_probs=gateway_probs,
    )
    result = MonteCarloSimulator.run(graph, config)
    return result.to_dict()


def _tool_mmc_queue(args: dict[str, Any], ctx) -> dict[str, Any]:
    arrival = float(args.get("arrival_rate", 0))
    service = float(args.get("service_rate", 0))
    servers = int(args.get("servers", 1))
    r = MMcQueueAnalyzer.analyze(arrival, service, servers)
    return {
        "arrival_rate": r.arrival_rate,
        "service_rate": r.service_rate,
        "servers": r.servers,
        "utilization": round(r.utilization, 4),
        "is_stable": r.is_stable,
        "avg_queue_length": _fmt(r.avg_queue_length),
        "avg_wait_time": _fmt(r.avg_wait_time),
        "avg_system_time": _fmt(r.avg_system_time),
        "avg_in_system": _fmt(r.avg_in_system),
        "probability_empty": round(r.probability_empty, 4),
        "notes": r.notes,
    }


# ── Methodology selector ─────────────────────────────────────────────────────

def _tool_methodology_recommend(args: dict[str, Any], ctx) -> dict[str, Any]:
    xml = args.get("xml")
    signals = args.get("signals") or {}
    graph = BpmnParser.parse(xml) if xml else None
    recs = MethodologySelector.recommend(graph=graph, signals=signals)
    return {
        "recommendations": [
            {
                "methodology": r.methodology,
                "score": round(r.score, 2),
                "rationale": r.rationale,
                "next_actions": r.next_actions,
                "artifacts": r.artifacts_to_produce,
            }
            for r in recs
        ]
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _fmt(v: float) -> float | str:
    if v != v:  # NaN
        return "n/a"
    if v == float("inf"):
        return "infinity"
    return round(v, 3)


# ── Register ─────────────────────────────────────────────────────────────────

TOOL_REGISTRY.register(Tool(
    name="bpmn.parse",
    description="Parsea XML BPMN 2.0 y devuelve nodos, flujos y estadísticas.",
    input_schema={"type": "object", "properties": {"xml": {"type": "string"}}, "required": ["xml"]},
    runner=_tool_bpmn_parse, category="bpmn",
))
TOOL_REGISTRY.register(Tool(
    name="bpmn.analyze",
    description="Analiza un BPMN 2.0: loops, dead-ends, redundancias, cadenas de aprobación, etc.",
    input_schema={"type": "object", "properties": {"xml": {"type": "string"}}, "required": ["xml"]},
    runner=_tool_bpmn_analyze, category="bpmn", cost_estimate="medium",
))
TOOL_REGISTRY.register(Tool(
    name="bpmn.paths",
    description="Enumera rutas de ejecución (con probabilidades) en un BPMN.",
    input_schema={"type": "object", "properties": {
        "xml": {"type": "string"},
        "gateway_probs": {"type": "object"},
    }, "required": ["xml"]},
    runner=_tool_bpmn_paths, category="bpmn",
))
TOOL_REGISTRY.register(Tool(
    name="bpmn.simulate",
    description="Simulación Monte Carlo del BPMN con tiempos por nodo y probabilidades de gateway.",
    input_schema={"type": "object", "properties": {
        "xml": {"type": "string"},
        "iterations": {"type": "integer", "default": 1000},
        "default_task_mean": {"type": "number"},
        "default_task_stdev": {"type": "number"},
        "timings": {"type": "object"},
        "gateway_probs": {"type": "object"},
    }, "required": ["xml"]},
    runner=_tool_bpmn_simulate, category="simulation", cost_estimate="high",
))
TOOL_REGISTRY.register(Tool(
    name="lean.mudas",
    description="Detecta los 8 desperdicios Lean (TIMWOODS) en un BPMN.",
    input_schema={"type": "object", "properties": {"xml": {"type": "string"}}, "required": ["xml"]},
    runner=_tool_lean_mudas, category="methodology",
))
TOOL_REGISTRY.register(Tool(
    name="sixsigma.dpmo",
    description="Calcula DPMO, nivel Sigma y yield desde defectos / oportunidades / unidades.",
    input_schema={"type": "object", "properties": {
        "defects": {"type": "integer"},
        "opportunities": {"type": "integer"},
        "units": {"type": "integer"},
    }, "required": ["defects", "opportunities", "units"]},
    runner=_tool_sixsigma_dpmo, category="methodology",
))
TOOL_REGISTRY.register(Tool(
    name="toc.constraints",
    description="Identifica candidatos a restricción (cuello de botella) según Teoría de Restricciones.",
    input_schema={"type": "object", "properties": {"xml": {"type": "string"}}, "required": ["xml"]},
    runner=_tool_toc_constraints, category="methodology",
))
TOOL_REGISTRY.register(Tool(
    name="queue.mmc",
    description="Análisis M/M/c: utilización, tiempos de espera, longitud de cola.",
    input_schema={"type": "object", "properties": {
        "arrival_rate": {"type": "number"},
        "service_rate": {"type": "number"},
        "servers": {"type": "integer"},
    }, "required": ["arrival_rate", "service_rate", "servers"]},
    runner=_tool_mmc_queue, category="analytics",
))
TOOL_REGISTRY.register(Tool(
    name="methodology.recommend",
    description="Recomienda metodología(s) de mejora según el BPMN y señales del contexto.",
    input_schema={"type": "object", "properties": {
        "xml": {"type": "string"},
        "signals": {"type": "object"},
    }},
    runner=_tool_methodology_recommend, category="methodology",
))
