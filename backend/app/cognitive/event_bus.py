"""
EventBus — In-process Pub/Sub for cross-agent reactivity.

Lightweight event-driven layer (Kafka-equivalent pattern for now in-process).
Allows agents to react to organizational events without tight coupling.

Future: swap implementation for Kafka/RabbitMQ — interface stays the same.
"""
from __future__ import annotations

from app.core.logging import get_logger
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Callable, Protocol
from uuid import uuid4

logger = get_logger(__name__)


# ── Event types (canonical organizational events) ────────────────────────────

# Process lifecycle
EVT_PROCESS_CREATED = "process.created"
EVT_PROCESS_UPDATED = "process.updated"
EVT_PROCESS_DELETED = "process.deleted"
EVT_PROCESS_ANALYZED = "process.analyzed"
EVT_PROCESS_STALE = "process.stale"

# Hierarchy lifecycle
EVT_HIERARCHY_CHANGED = "hierarchy.changed"
EVT_CHILDREN_AGGREGATED = "hierarchy.children_aggregated"

# Analysis lifecycle
EVT_BOTTLENECK_DETECTED = "analysis.bottleneck_detected"
EVT_RISK_DETECTED = "analysis.risk_detected"
EVT_ANOMALY_DETECTED = "analysis.anomaly_detected"
EVT_KPI_DETERIORATING = "analysis.kpi_deteriorating"

# Knowledge lifecycle
EVT_DOCUMENT_ADDED = "knowledge.document_added"
EVT_INSIGHT_GENERATED = "knowledge.insight_generated"

# Agent lifecycle
EVT_AGENT_INVOKED = "agent.invoked"
EVT_AGENT_COMPLETED = "agent.completed"
EVT_AGENT_FAILED = "agent.failed"


@dataclass
class CognitiveEvent:
    """Canonical event passing through the bus."""
    id: str
    type: str
    payload: dict[str, Any]
    source: str  # which agent/service emitted
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    correlation_id: str | None = None  # to chain related events


class EventHandler(Protocol):
    def __call__(self, event: CognitiveEvent) -> None: ...


class EventBus:
    """
    Thread-safe in-process pub/sub.

    Handlers are invoked synchronously on publish — fine for now since most
    handlers are fast. Future: async queue with workers.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, list[EventHandler]] = {}
        self._wildcards: list[EventHandler] = []  # handlers for "*"
        self._lock = threading.RLock()
        self._history: list[CognitiveEvent] = []  # last N for observability
        self._history_max = 500

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        with self._lock:
            if event_type == "*":
                self._wildcards.append(handler)
            else:
                self._handlers.setdefault(event_type, []).append(handler)

    def unsubscribe(self, event_type: str, handler: EventHandler) -> None:
        with self._lock:
            if event_type == "*":
                if handler in self._wildcards:
                    self._wildcards.remove(handler)
            else:
                if event_type in self._handlers and handler in self._handlers[event_type]:
                    self._handlers[event_type].remove(handler)

    def publish(
        self,
        event_type: str,
        payload: dict[str, Any],
        source: str,
        correlation_id: str | None = None,
    ) -> CognitiveEvent:
        event = CognitiveEvent(
            id=str(uuid4()),
            type=event_type,
            payload=payload,
            source=source,
            correlation_id=correlation_id,
        )
        with self._lock:
            self._history.append(event)
            if len(self._history) > self._history_max:
                self._history = self._history[-self._history_max:]
            handlers = list(self._handlers.get(event_type, []))
            wildcards = list(self._wildcards)

        for handler in handlers + wildcards:
            try:
                handler(event)
            except Exception as e:
                logger.exception("Event handler failed for %s: %s", event_type, e)

        return event

    def recent(self, n: int = 50, event_type: str | None = None) -> list[CognitiveEvent]:
        with self._lock:
            events = (
                [e for e in self._history if e.type == event_type]
                if event_type else list(self._history)
            )
            return events[-n:]


# Global singleton
EVENT_BUS = EventBus()
