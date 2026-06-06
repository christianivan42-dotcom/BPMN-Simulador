"""
Observability layer for the cognitive system.

Provides:
    - per-session traces (from SharedState)
    - event history (from EventBus)
    - agent invocation stats (counts, durations, errors)
    - tool call stats
    - latency dashboards

Future: integrate OpenTelemetry / Prometheus.
"""
from __future__ import annotations

import threading
from collections import defaultdict, deque
from typing import Any


class CognitiveObservability:
    """In-memory observability backbone."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        # Per-agent counters
        self._agent_invocations: dict[str, int] = defaultdict(int)
        self._agent_failures: dict[str, int] = defaultdict(int)
        self._agent_durations: dict[str, list[int]] = defaultdict(list)  # ms
        # Per-tool counters
        self._tool_calls: dict[str, int] = defaultdict(int)
        self._tool_failures: dict[str, int] = defaultdict(int)
        self._tool_durations: dict[str, list[int]] = defaultdict(list)
        # Per-session history (last N turns)
        self._session_turns: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=50))
        # Recent activity ring buffer
        self._recent_events: deque[dict[str, Any]] = deque(maxlen=200)

    # ── Recording ─────────────────────────────────────────────────────────────

    def record_agent(self, agent: str, duration_ms: int, success: bool) -> None:
        with self._lock:
            self._agent_invocations[agent] += 1
            if not success:
                self._agent_failures[agent] += 1
            self._agent_durations[agent].append(duration_ms)
            if len(self._agent_durations[agent]) > 100:
                self._agent_durations[agent] = self._agent_durations[agent][-100:]

    def record_tool(self, tool: str, duration_ms: int, success: bool) -> None:
        with self._lock:
            self._tool_calls[tool] += 1
            if not success:
                self._tool_failures[tool] += 1
            self._tool_durations[tool].append(duration_ms)
            if len(self._tool_durations[tool]) > 100:
                self._tool_durations[tool] = self._tool_durations[tool][-100:]

    def record_turn(self, session_id: str, turn: dict[str, Any]) -> None:
        with self._lock:
            self._session_turns[session_id].append(turn)
            self._recent_events.append({
                "session": session_id,
                **turn,
            })

    # ── Querying ──────────────────────────────────────────────────────────────

    def agent_stats(self) -> list[dict[str, Any]]:
        with self._lock:
            agents = set(self._agent_invocations.keys())
            result = []
            for agent in sorted(agents):
                durations = self._agent_durations[agent]
                avg = int(sum(durations) / len(durations)) if durations else 0
                invocations = self._agent_invocations[agent]
                failures = self._agent_failures[agent]
                result.append({
                    "agent": agent,
                    "invocations": invocations,
                    "failures": failures,
                    "success_rate": round((invocations - failures) / invocations, 3) if invocations else 1.0,
                    "avg_duration_ms": avg,
                    "p95_duration_ms": _percentile(durations, 95) if durations else 0,
                })
            return result

    def tool_stats(self) -> list[dict[str, Any]]:
        with self._lock:
            tools = set(self._tool_calls.keys())
            result = []
            for tool in sorted(tools):
                durations = self._tool_durations[tool]
                avg = int(sum(durations) / len(durations)) if durations else 0
                calls = self._tool_calls[tool]
                failures = self._tool_failures[tool]
                result.append({
                    "tool": tool,
                    "calls": calls,
                    "failures": failures,
                    "success_rate": round((calls - failures) / calls, 3) if calls else 1.0,
                    "avg_duration_ms": avg,
                })
            return result

    def session_history(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._session_turns.get(session_id, []))

    def recent_activity(self, n: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._recent_events)[-n:]

    def health(self) -> dict[str, Any]:
        with self._lock:
            total_invocations = sum(self._agent_invocations.values())
            total_failures = sum(self._agent_failures.values())
            total_tools = sum(self._tool_calls.values())
            return {
                "agents_registered": len(self._agent_invocations) + 1,  # +planner
                "total_invocations": total_invocations,
                "total_failures": total_failures,
                "success_rate": round((total_invocations - total_failures) / total_invocations, 3) if total_invocations else 1.0,
                "total_tool_calls": total_tools,
                "active_sessions": len(self._session_turns),
            }


def _percentile(values: list[int], pct: int) -> int:
    if not values:
        return 0
    sorted_v = sorted(values)
    k = int(len(sorted_v) * pct / 100)
    return sorted_v[min(k, len(sorted_v) - 1)]


# Singleton
OBSERVABILITY = CognitiveObservability()
