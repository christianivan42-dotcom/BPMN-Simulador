"""
AgentRegistry — central catalog of all cognitive agents.

Agents register themselves at import time. The orchestrator queries the
registry to find agents by capability or by matching a query.
"""
from __future__ import annotations

from app.core.logging import get_logger
import threading
from typing import Type

from app.cognitive.agents.base import AgentCapability, BaseAgent

logger = get_logger(__name__)


class AgentRegistry:
    """Thread-safe registry of agent classes."""

    def __init__(self) -> None:
        self._agents: dict[str, BaseAgent] = {}
        self._lock = threading.RLock()

    def register(self, agent: BaseAgent | Type[BaseAgent]) -> BaseAgent:
        """Register an instance or class — class will be instantiated."""
        instance: BaseAgent = agent() if isinstance(agent, type) else agent
        with self._lock:
            if instance.name in self._agents:
                logger.warning("Re-registering agent %s", instance.name)
            self._agents[instance.name] = instance
        return instance

    def get(self, name: str) -> BaseAgent | None:
        with self._lock:
            return self._agents.get(name)

    def all_agents(self) -> list[BaseAgent]:
        with self._lock:
            return list(self._agents.values())

    def by_capability(self, capability: AgentCapability) -> list[BaseAgent]:
        with self._lock:
            return [a for a in self._agents.values() if capability in a.capabilities]

    def rank_by_query(self, query: str, top_n: int = 5) -> list[BaseAgent]:
        """Score agents by keyword match and return top N."""
        with self._lock:
            scored = [(a, a.matches(query)) for a in self._agents.values()]
            scored.sort(key=lambda t: -t[1])
            return [a for a, score in scored[:top_n] if score > 0]

    def names(self) -> list[str]:
        with self._lock:
            return list(self._agents.keys())

    def describe(self) -> list[dict]:
        """Manifest of all registered agents for the UI/API."""
        with self._lock:
            return [
                {
                    "name": a.name,
                    "description": a.description,
                    "capabilities": [c.value for c in a.capabilities],
                    "keywords": a.keywords,
                }
                for a in self._agents.values()
            ]


# Global registry
AGENT_REGISTRY = AgentRegistry()
