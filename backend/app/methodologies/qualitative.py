"""
Qualitative analysis techniques — SIPOC, 5 Whys, Ishikawa, FMEA, VSM.

These are produced/consumed by the qualitative analysis agent.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SIPOC:
    """Supplier - Input - Process - Output - Customer."""
    process_name: str
    suppliers: list[str] = field(default_factory=list)
    inputs: list[str] = field(default_factory=list)
    process_steps: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    customers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "process_name": self.process_name,
            "suppliers": self.suppliers,
            "inputs": self.inputs,
            "process_steps": self.process_steps,
            "outputs": self.outputs,
            "customers": self.customers,
        }


@dataclass
class FiveWhys:
    """5 Whys root cause analysis."""
    problem: str
    why_chain: list[str] = field(default_factory=list)  # 5 niveles "por qué?"
    root_cause: str = ""
    countermeasure: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "problem": self.problem,
            "why_chain": self.why_chain,
            "root_cause": self.root_cause,
            "countermeasure": self.countermeasure,
        }


@dataclass
class IshikawaBranch:
    """A branch in an Ishikawa (cause-effect) diagram."""
    category: str  # M's: Manpower, Method, Machine, Material, Measurement, Mother Nature
    causes: list[str] = field(default_factory=list)


@dataclass
class IshikawaDiagram:
    """Cause-effect (fishbone) diagram."""
    effect: str  # the problem
    branches: list[IshikawaBranch] = field(default_factory=list)

    @classmethod
    def template(cls, effect: str) -> "IshikawaDiagram":
        return cls(
            effect=effect,
            branches=[
                IshikawaBranch(category="Personas (Manpower)"),
                IshikawaBranch(category="Métodos (Method)"),
                IshikawaBranch(category="Máquinas / Sistemas (Machine)"),
                IshikawaBranch(category="Materiales / Información (Material)"),
                IshikawaBranch(category="Medición (Measurement)"),
                IshikawaBranch(category="Entorno (Mother Nature)"),
            ],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "effect": self.effect,
            "branches": [{"category": b.category, "causes": b.causes} for b in self.branches],
        }


@dataclass
class FMEAEntry:
    """Failure Modes and Effects Analysis row."""
    function: str
    failure_mode: str
    effect: str
    severity: int        # 1-10
    cause: str
    occurrence: int      # 1-10
    current_control: str
    detection: int       # 1-10
    rpn: int = 0         # Risk Priority Number = S × O × D
    recommended_action: str = ""

    def compute_rpn(self) -> int:
        self.rpn = self.severity * self.occurrence * self.detection
        return self.rpn

    def to_dict(self) -> dict[str, Any]:
        return {
            "function": self.function,
            "failure_mode": self.failure_mode,
            "effect": self.effect,
            "severity": self.severity,
            "cause": self.cause,
            "occurrence": self.occurrence,
            "current_control": self.current_control,
            "detection": self.detection,
            "rpn": self.rpn,
            "recommended_action": self.recommended_action,
        }


@dataclass
class VsmStep:
    name: str
    cycle_time: float       # min
    setup_time: float       # min
    uptime_pct: float       # 0-100
    operators: int
    is_value_added: bool


@dataclass
class ValueStreamMap:
    """Value Stream Map — Lean tool for end-to-end flow."""
    process_name: str
    steps: list[VsmStep] = field(default_factory=list)
    customer_demand: float = 0.0  # units/period
    available_time: float = 0.0   # min/period

    def takt_time(self) -> float:
        if self.customer_demand <= 0:
            return 0.0
        return self.available_time / self.customer_demand

    def total_cycle_time(self) -> float:
        return sum(s.cycle_time for s in self.steps)

    def value_added_time(self) -> float:
        return sum(s.cycle_time for s in self.steps if s.is_value_added)

    def value_added_ratio(self) -> float:
        total = self.total_cycle_time()
        if total <= 0:
            return 0.0
        return (self.value_added_time() / total) * 100

    def to_dict(self) -> dict[str, Any]:
        return {
            "process_name": self.process_name,
            "takt_time_min": round(self.takt_time(), 2),
            "total_cycle_time_min": round(self.total_cycle_time(), 2),
            "value_added_time_min": round(self.value_added_time(), 2),
            "value_added_ratio_pct": round(self.value_added_ratio(), 2),
            "steps": [
                {
                    "name": s.name,
                    "cycle_time_min": s.cycle_time,
                    "setup_time_min": s.setup_time,
                    "uptime_pct": s.uptime_pct,
                    "operators": s.operators,
                    "is_value_added": s.is_value_added,
                }
                for s in self.steps
            ],
        }
