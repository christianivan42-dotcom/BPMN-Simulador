"""
MonteCarloSimulator — Discrete-event Monte Carlo simulation over a BPMN process.

Each node has a timing profile (mean, stdev, distribution).
Each exclusive gateway has branch probabilities.

Per iteration:
    - Start at the Start Event
    - Walk through the graph, sampling time at each node
    - At exclusive gateways, sample which branch to take using probabilities
    - At parallel gateways, all branches execute in parallel — take max time
    - Stop when reaching an End Event or hitting a depth/time cap

Aggregates: mean, median, p5/p95, min, max cycle time + per-node utilization.
"""
from __future__ import annotations

import math
import random
import statistics as stat
from collections import defaultdict
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.bpmn_intel.parser import (
    GATEWAY_KINDS, TASK_KINDS, NodeKind, ProcessGraph,
)


class TimingDistribution(StrEnum):
    CONSTANT = "constant"
    NORMAL = "normal"
    EXPONENTIAL = "exponential"
    LOGNORMAL = "lognormal"
    UNIFORM = "uniform"


@dataclass
class NodeTimingProfile:
    node_id: str
    mean: float            # in chosen time units (e.g. minutes)
    stdev: float = 0.0
    distribution: TimingDistribution = TimingDistribution.NORMAL
    min_value: float = 0.0


@dataclass
class SimulationConfig:
    iterations: int = 1000
    time_unit: str = "minutos"
    timings: dict[str, NodeTimingProfile] = field(default_factory=dict)
    gateway_probs: dict[str, dict[str, float]] = field(default_factory=dict)
    # If node has no timing profile, use this default (in time_unit)
    default_task_mean: float = 5.0
    default_task_stdev: float = 2.0
    default_event_mean: float = 0.0
    max_depth: int = 500


@dataclass
class SimulationResult:
    config: dict[str, Any]
    iterations: int
    cycle_times: list[float]
    # Aggregates
    mean_cycle_time: float
    median_cycle_time: float
    min_cycle_time: float
    max_cycle_time: float
    p5_cycle_time: float
    p95_cycle_time: float
    stdev_cycle_time: float
    # Per-node stats
    node_visits: dict[str, int] = field(default_factory=dict)
    node_total_time: dict[str, float] = field(default_factory=dict)
    completed_iterations: int = 0
    truncated_iterations: int = 0  # hit max_depth

    def to_dict(self) -> dict[str, Any]:
        return {
            "iterations": self.iterations,
            "completed_iterations": self.completed_iterations,
            "truncated_iterations": self.truncated_iterations,
            "mean_cycle_time": round(self.mean_cycle_time, 2),
            "median_cycle_time": round(self.median_cycle_time, 2),
            "min_cycle_time": round(self.min_cycle_time, 2),
            "max_cycle_time": round(self.max_cycle_time, 2),
            "p5_cycle_time": round(self.p5_cycle_time, 2),
            "p95_cycle_time": round(self.p95_cycle_time, 2),
            "stdev_cycle_time": round(self.stdev_cycle_time, 2),
            "node_visits": dict(self.node_visits),
            "node_total_time": {k: round(v, 2) for k, v in self.node_total_time.items()},
            "time_unit": self.config.get("time_unit", "minutos"),
        }


class MonteCarloSimulator:
    """Stateless Monte Carlo simulator."""

    @staticmethod
    def run(graph: ProcessGraph, config: SimulationConfig | None = None) -> SimulationResult:
        cfg = config or SimulationConfig()
        cycle_times: list[float] = []
        node_visits: dict[str, int] = defaultdict(int)
        node_total_time: dict[str, float] = defaultdict(float)
        truncated = 0
        completed = 0

        starts = graph.start_events()
        if not starts:
            return _empty_result(cfg)

        for _ in range(cfg.iterations):
            iter_time, iter_visits, iter_node_times, was_truncated = _simulate_iteration(
                graph, starts[0].id, cfg,
            )
            if was_truncated:
                truncated += 1
            else:
                completed += 1
            cycle_times.append(iter_time)
            for nid, count in iter_visits.items():
                node_visits[nid] += count
            for nid, t in iter_node_times.items():
                node_total_time[nid] += t

        return SimulationResult(
            config={
                "iterations": cfg.iterations,
                "time_unit": cfg.time_unit,
                "default_task_mean": cfg.default_task_mean,
            },
            iterations=cfg.iterations,
            cycle_times=cycle_times,
            mean_cycle_time=stat.fmean(cycle_times) if cycle_times else 0.0,
            median_cycle_time=stat.median(cycle_times) if cycle_times else 0.0,
            min_cycle_time=min(cycle_times) if cycle_times else 0.0,
            max_cycle_time=max(cycle_times) if cycle_times else 0.0,
            p5_cycle_time=_percentile(cycle_times, 5),
            p95_cycle_time=_percentile(cycle_times, 95),
            stdev_cycle_time=stat.pstdev(cycle_times) if len(cycle_times) > 1 else 0.0,
            node_visits=dict(node_visits),
            node_total_time=dict(node_total_time),
            completed_iterations=completed,
            truncated_iterations=truncated,
        )


def _simulate_iteration(
    graph: ProcessGraph,
    start_id: str,
    cfg: SimulationConfig,
) -> tuple[float, dict[str, int], dict[str, float], bool]:
    """Run one iteration. Returns (total_time, visits, node_times, was_truncated)."""
    visits: dict[str, int] = defaultdict(int)
    node_times: dict[str, float] = defaultdict(float)
    total_time = 0.0
    truncated = False

    # Active fronts (for parallel gateways): list of (node_id, accumulated_time)
    fronts: list[tuple[str, float]] = [(start_id, 0.0)]
    depth = 0
    max_observed_time = 0.0

    while fronts and depth < cfg.max_depth:
        depth += 1
        new_fronts: list[tuple[str, float]] = []
        # All current fronts advance one step
        for node_id, elapsed in fronts:
            node = graph.nodes.get(node_id)
            if node is None:
                continue
            visits[node_id] += 1
            duration = _sample_duration(node, cfg)
            new_time = elapsed + duration
            node_times[node_id] += duration
            max_observed_time = max(max_observed_time, new_time)

            if node.kind == NodeKind.END_EVENT:
                # This front terminates
                total_time = max(total_time, new_time)
                continue

            outgoing = graph.outgoing(node_id)
            if not outgoing:
                # Dead end — terminate
                total_time = max(total_time, new_time)
                continue

            if node.kind == NodeKind.EXCLUSIVE_GATEWAY:
                # Sample one branch
                chosen = _sample_branch(node_id, outgoing, cfg)
                new_fronts.append((chosen.target_id, new_time))
            elif node.kind == NodeKind.PARALLEL_GATEWAY:
                # All branches happen
                for f in outgoing:
                    new_fronts.append((f.target_id, new_time))
            elif node.kind == NodeKind.INCLUSIVE_GATEWAY:
                # Take at least one — treat as exclusive for simplicity
                chosen = _sample_branch(node_id, outgoing, cfg)
                new_fronts.append((chosen.target_id, new_time))
            else:
                # Sequential — take the first outgoing
                # If multiple, pick first deterministically
                new_fronts.append((outgoing[0].target_id, new_time))

        fronts = new_fronts

    if depth >= cfg.max_depth:
        truncated = True
        total_time = max(total_time, max_observed_time)

    return total_time, dict(visits), dict(node_times), truncated


def _sample_duration(node, cfg: SimulationConfig) -> float:
    profile = cfg.timings.get(node.id)
    if profile is None:
        if node.kind in TASK_KINDS:
            mean = cfg.default_task_mean
            stdev = cfg.default_task_stdev
            dist = TimingDistribution.NORMAL
            min_val = 0.0
        else:
            return cfg.default_event_mean
    else:
        mean = profile.mean
        stdev = profile.stdev
        dist = profile.distribution
        min_val = profile.min_value

    if dist == TimingDistribution.CONSTANT:
        return mean
    if dist == TimingDistribution.NORMAL:
        v = random.gauss(mean, stdev) if stdev > 0 else mean
    elif dist == TimingDistribution.EXPONENTIAL:
        v = random.expovariate(1.0 / mean) if mean > 0 else 0.0
    elif dist == TimingDistribution.LOGNORMAL:
        if mean <= 0:
            return 0.0
        sigma = math.sqrt(math.log(1 + (stdev / mean) ** 2)) if stdev > 0 else 0.1
        mu = math.log(mean) - 0.5 * sigma ** 2
        v = random.lognormvariate(mu, sigma)
    elif dist == TimingDistribution.UNIFORM:
        v = random.uniform(max(0.0, mean - stdev), mean + stdev)
    else:
        v = mean
    return max(v, min_val)


def _sample_branch(gateway_id: str, outgoing: list, cfg: SimulationConfig):
    probs = cfg.gateway_probs.get(gateway_id, {})
    if not probs:
        return random.choice(outgoing)
    weights = [probs.get(f.id, 1.0 / len(outgoing)) for f in outgoing]
    total = sum(weights)
    if total <= 0:
        return random.choice(outgoing)
    r = random.uniform(0, total)
    acc = 0.0
    for f, w in zip(outgoing, weights):
        acc += w
        if r <= acc:
            return f
    return outgoing[-1]


def _percentile(values: list[float], p: int) -> float:
    if not values:
        return 0.0
    sorted_v = sorted(values)
    k = (len(sorted_v) - 1) * p / 100.0
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_v[int(k)]
    return sorted_v[f] * (c - k) + sorted_v[c] * (k - f)


def _empty_result(cfg: SimulationConfig) -> SimulationResult:
    return SimulationResult(
        config={"iterations": cfg.iterations, "time_unit": cfg.time_unit},
        iterations=cfg.iterations,
        cycle_times=[],
        mean_cycle_time=0.0, median_cycle_time=0.0,
        min_cycle_time=0.0, max_cycle_time=0.0,
        p5_cycle_time=0.0, p95_cycle_time=0.0, stdev_cycle_time=0.0,
        completed_iterations=0, truncated_iterations=0,
    )
