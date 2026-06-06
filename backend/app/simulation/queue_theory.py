"""
M/M/c Queuing analysis — for resource-constrained activities.

Formulas:
    λ = arrival rate
    μ = service rate per server
    c = number of servers
    ρ = λ / (c * μ)  — utilization (must be < 1 for stable queue)

    P_0 = 1 / ( Σ_{n=0}^{c-1} (cρ)^n / n!  +  (cρ)^c / (c! * (1 - ρ)) )
    Lq  = (cρ)^c * ρ / (c! * (1-ρ)^2) * P_0     — average queue length
    Wq  = Lq / λ                                  — average wait time
    W   = Wq + 1/μ                                — total time in system
    L   = λ * W                                   — average in system

Used by the QuantitativeProcessAgent to estimate wait times at bottleneck activities.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class MMcResult:
    arrival_rate: float       # λ
    service_rate: float        # μ
    servers: int               # c
    utilization: float         # ρ
    is_stable: bool
    avg_queue_length: float    # Lq
    avg_wait_time: float       # Wq
    avg_system_time: float     # W
    avg_in_system: float       # L
    probability_empty: float   # P0
    notes: str = ""


class MMcQueueAnalyzer:
    """Computes M/M/c queue metrics."""

    @staticmethod
    def analyze(arrival_rate: float, service_rate: float, servers: int) -> MMcResult:
        """
        arrival_rate: jobs per unit time
        service_rate: jobs per unit time per server
        servers: number of parallel servers
        """
        if arrival_rate <= 0 or service_rate <= 0 or servers <= 0:
            return MMcResult(
                arrival_rate=arrival_rate, service_rate=service_rate, servers=servers,
                utilization=0.0, is_stable=False,
                avg_queue_length=0, avg_wait_time=0, avg_system_time=0, avg_in_system=0,
                probability_empty=0,
                notes="Parámetros inválidos (deben ser positivos).",
            )

        rho = arrival_rate / (servers * service_rate)
        is_stable = rho < 1

        if not is_stable:
            return MMcResult(
                arrival_rate=arrival_rate, service_rate=service_rate, servers=servers,
                utilization=rho, is_stable=False,
                avg_queue_length=math.inf, avg_wait_time=math.inf,
                avg_system_time=math.inf, avg_in_system=math.inf,
                probability_empty=0,
                notes=(
                    f"Sistema inestable (ρ={rho:.2f} ≥ 1). "
                    f"La cola crecerá sin límite. Necesitas más servidores o mayor μ."
                ),
            )

        c_rho = servers * rho
        # P0 calculation
        sum_terms = sum((c_rho ** n) / math.factorial(n) for n in range(servers))
        last_term = (c_rho ** servers) / (math.factorial(servers) * (1 - rho))
        p0 = 1.0 / (sum_terms + last_term)

        # Lq
        lq = ((c_rho ** servers) * rho) / (math.factorial(servers) * (1 - rho) ** 2) * p0
        # Wq
        wq = lq / arrival_rate
        # W = Wq + 1/μ
        w = wq + 1.0 / service_rate
        # L = λW
        l_total = arrival_rate * w

        notes = ""
        if rho > 0.9:
            notes = (
                f"Utilización muy alta (ρ={rho:.2%}). "
                f"Tiempos de espera son muy sensibles a cualquier aumento de demanda."
            )
        elif rho > 0.7:
            notes = f"Utilización alta (ρ={rho:.2%}). Margen limitado para crecimiento."
        else:
            notes = f"Utilización saludable (ρ={rho:.2%})."

        return MMcResult(
            arrival_rate=arrival_rate, service_rate=service_rate, servers=servers,
            utilization=rho, is_stable=True,
            avg_queue_length=lq, avg_wait_time=wq,
            avg_system_time=w, avg_in_system=l_total,
            probability_empty=p0,
            notes=notes,
        )

    @staticmethod
    def recommend_servers(arrival_rate: float, service_rate: float, max_wait: float) -> int:
        """Recommend minimum servers c such that Wq ≤ max_wait."""
        for c in range(1, 50):
            result = MMcQueueAnalyzer.analyze(arrival_rate, service_rate, c)
            if result.is_stable and result.avg_wait_time <= max_wait:
                return c
        return -1  # not achievable within reasonable c
