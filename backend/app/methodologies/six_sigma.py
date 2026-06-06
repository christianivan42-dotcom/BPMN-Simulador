"""
Six Sigma DMAIC methodology + statistical helpers.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class DMAICPhase(StrEnum):
    DEFINE = "define"
    MEASURE = "measure"
    ANALYZE = "analyze"
    IMPROVE = "improve"
    CONTROL = "control"


@dataclass
class DMAICStep:
    phase: DMAICPhase
    name: str
    objective: str
    deliverables: list[str]
    tools: list[str]


DMAIC_FRAMEWORK: dict[DMAICPhase, DMAICStep] = {
    DMAICPhase.DEFINE: DMAICStep(
        phase=DMAICPhase.DEFINE,
        name="Define",
        objective="Definir el problema, alcance, equipo y métricas críticas",
        deliverables=["Project Charter", "VOC (Voice of Customer)", "CTQ Tree", "SIPOC"],
        tools=["Project Charter", "VOC", "CTQ", "SIPOC", "Stakeholder Analysis"],
    ),
    DMAICPhase.MEASURE: DMAICStep(
        phase=DMAICPhase.MEASURE,
        name="Measure",
        objective="Medir el desempeño actual del proceso (baseline)",
        deliverables=["Plan de medición", "Sistema de medición validado", "Baseline metrics"],
        tools=["MSA / Gage R&R", "Capacidad (Cp/Cpk)", "Sigma baseline", "Data collection plan"],
    ),
    DMAICPhase.ANALYZE: DMAICStep(
        phase=DMAICPhase.ANALYZE,
        name="Analyze",
        objective="Identificar causas raíz de la variabilidad / defectos",
        deliverables=["Hipótesis de causas raíz", "Verificación estadística"],
        tools=["Ishikawa", "5 Whys", "FMEA", "Hypothesis testing", "Regression", "ANOVA"],
    ),
    DMAICPhase.IMPROVE: DMAICStep(
        phase=DMAICPhase.IMPROVE,
        name="Improve",
        objective="Diseñar e implementar soluciones que ataquen causas raíz",
        deliverables=["Solución diseñada", "Piloto", "Plan de implementación"],
        tools=["DOE (Design of Experiments)", "Brainstorming", "Pilot project", "Cost-benefit"],
    ),
    DMAICPhase.CONTROL: DMAICStep(
        phase=DMAICPhase.CONTROL,
        name="Control",
        objective="Sostener las mejoras y prevenir regresiones",
        deliverables=["Control plan", "SPC charts", "Documentación de proceso"],
        tools=["SPC (X-bar/R, p, u charts)", "Control plan", "Documentación", "Auditorías"],
    ),
}


class SixSigmaMethodology:
    """Six Sigma DMAIC and statistical helpers."""

    @staticmethod
    def framework() -> list[DMAICStep]:
        return list(DMAIC_FRAMEWORK.values())

    @staticmethod
    def phase(name: str | DMAICPhase) -> DMAICStep | None:
        try:
            p = DMAICPhase(name) if isinstance(name, str) else name
            return DMAIC_FRAMEWORK.get(p)
        except ValueError:
            return None

    # ── Statistical formulas ──────────────────────────────────────────────────

    @staticmethod
    def dpmo(defects: int, opportunities: int, units: int) -> float:
        """Defects Per Million Opportunities."""
        if opportunities <= 0 or units <= 0:
            return 0.0
        return (defects / (opportunities * units)) * 1_000_000

    @staticmethod
    def sigma_level(dpmo_value: float) -> float:
        """Sigma level from DPMO using inverse normal approximation."""
        if dpmo_value <= 0:
            return 6.0
        if dpmo_value >= 1_000_000:
            return 0.0
        p = 1.0 - dpmo_value / 1_000_000
        # Beasley-Springer-Moro approximation
        sigma = SixSigmaMethodology._inverse_normal_cdf(p) + 1.5
        return round(sigma, 2)

    @staticmethod
    def yield_from_dpmo(dpmo_value: float) -> float:
        """First-pass yield (rendimiento) from DPMO."""
        if dpmo_value <= 0:
            return 1.0
        return max(0.0, 1.0 - (dpmo_value / 1_000_000))

    @staticmethod
    def cp(usl: float, lsl: float, sigma: float) -> float:
        """Capability index (theoretical)."""
        if sigma <= 0:
            return 0.0
        return (usl - lsl) / (6 * sigma)

    @staticmethod
    def cpk(usl: float, lsl: float, mean: float, sigma: float) -> float:
        """Capability index (actual)."""
        if sigma <= 0:
            return 0.0
        return min(
            (usl - mean) / (3 * sigma),
            (mean - lsl) / (3 * sigma),
        )

    @staticmethod
    def _inverse_normal_cdf(p: float) -> float:
        """Approximation of inverse standard normal CDF (Φ^-1)."""
        if p <= 0:
            return -6.0
        if p >= 1:
            return 6.0
        # Beasley-Springer-Moro for tails
        a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
        b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01]
        c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
        d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00]

        plow = 0.02425
        phigh = 1 - plow
        if p < plow:
            q = math.sqrt(-2 * math.log(p))
            return (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) / \
                   ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1)
        elif p > phigh:
            q = math.sqrt(-2 * math.log(1 - p))
            return -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) / \
                    ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1)
        else:
            q = p - 0.5
            r = q * q
            return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5]) * q / \
                   (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1)
