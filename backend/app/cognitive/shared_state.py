"""
SharedState — Cognitive Blackboard

Inspired by Blackboard Architecture (Hayes-Roth, 1985) and modern
multi-agent shared state systems (Microsoft Copilot context layer,
Anthropic Claude shared scratchpad).

All agents in a cognitive session share this state — they read from it
to access prior reasoning, and write to it to publish their findings.

Key concepts:
    - BlackboardEntry: a single typed piece of knowledge published by an agent
    - SharedState: per-session container of entries
    - Topics: entries are tagged with topics (kpi, risk, hypothesis, etc.)
    - Versioning: each entry has a monotonic version for ordering
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


@dataclass
class BlackboardEntry:
    """A single piece of cognitive knowledge on the blackboard."""
    id: str
    session_id: str
    topic: str
    content: Any
    agent: str  # which agent published it
    version: int
    confidence: float = 1.0
    related_entries: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class SharedState:
    """
    Thread-safe per-session blackboard.

    Holds all cognitive entries produced during a reasoning session.
    Agents publish findings here; other agents read them to build on prior
    reasoning instead of re-computing it.
    """

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._entries: list[BlackboardEntry] = []
        self._lock = threading.RLock()
        self._version_counter = 0
        # Working memory: ephemeral key-value for the current turn
        self._working_memory: dict[str, Any] = {}
        # Reasoning trace: ordered list of agent actions for observability
        self._trace: list[dict[str, Any]] = []

    # ── Publishing & reading ──────────────────────────────────────────────────

    def publish(
        self,
        topic: str,
        content: Any,
        agent: str,
        *,
        confidence: float = 1.0,
        related: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> BlackboardEntry:
        """Agent publishes a finding to the blackboard."""
        with self._lock:
            self._version_counter += 1
            entry = BlackboardEntry(
                id=str(uuid4()),
                session_id=self.session_id,
                topic=topic,
                content=content,
                agent=agent,
                version=self._version_counter,
                confidence=confidence,
                related_entries=related or [],
                metadata=metadata or {},
            )
            self._entries.append(entry)
            self._trace.append({
                "ts": entry.created_at.isoformat(),
                "agent": agent,
                "action": "publish",
                "topic": topic,
                "entry_id": entry.id,
            })
            return entry

    def get(self, entry_id: str) -> BlackboardEntry | None:
        with self._lock:
            for e in self._entries:
                if e.id == entry_id:
                    return e
            return None

    def by_topic(self, topic: str) -> list[BlackboardEntry]:
        """Retrieve all entries for a given topic, ordered by version."""
        with self._lock:
            return sorted(
                [e for e in self._entries if e.topic == topic],
                key=lambda e: e.version,
            )

    def by_agent(self, agent: str) -> list[BlackboardEntry]:
        with self._lock:
            return [e for e in self._entries if e.agent == agent]

    def latest(self, topic: str) -> BlackboardEntry | None:
        """Last published entry for a topic."""
        entries = self.by_topic(topic)
        return entries[-1] if entries else None

    def all_entries(self) -> list[BlackboardEntry]:
        with self._lock:
            return list(self._entries)

    def topics(self) -> set[str]:
        with self._lock:
            return {e.topic for e in self._entries}

    # ── Working memory (ephemeral) ────────────────────────────────────────────

    def set_working(self, key: str, value: Any) -> None:
        with self._lock:
            self._working_memory[key] = value

    def get_working(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._working_memory.get(key, default)

    def working_keys(self) -> list[str]:
        with self._lock:
            return list(self._working_memory.keys())

    # ── Reasoning trace (observability) ───────────────────────────────────────

    def add_trace(self, agent: str, action: str, **meta: Any) -> None:
        with self._lock:
            self._trace.append({
                "ts": datetime.now(UTC).isoformat(),
                "agent": agent,
                "action": action,
                **meta,
            })

    def get_trace(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._trace)

    # ── Summarization for downstream agents ───────────────────────────────────

    def summary(self) -> dict[str, Any]:
        """Compact summary of the blackboard — used to inject context into prompts."""
        with self._lock:
            return {
                "session_id": self.session_id,
                "total_entries": len(self._entries),
                "topics": list(self.topics()),
                "agents_involved": list({e.agent for e in self._entries}),
                "latest_by_topic": {
                    t: self.latest(t).content if self.latest(t) else None
                    for t in self.topics()
                },
            }

    def context_brief(self, max_entries: int = 20) -> str:
        """Human-readable digest of the blackboard for LLM prompts."""
        with self._lock:
            relevant = sorted(self._entries, key=lambda e: -e.version)[:max_entries]
            if not relevant:
                return "(blackboard vacío)"
            lines = []
            for e in reversed(relevant):  # cronológico
                preview = str(e.content)
                if len(preview) > 200:
                    preview = preview[:200] + "…"
                lines.append(f"[{e.agent}] {e.topic}: {preview}")
            return "\n".join(lines)


# ── Session manager ───────────────────────────────────────────────────────────

class SharedStateManager:
    """Holds active SharedState instances by session_id."""

    def __init__(self) -> None:
        self._states: dict[str, SharedState] = {}
        self._lock = threading.RLock()

    def get_or_create(self, session_id: str) -> SharedState:
        with self._lock:
            state = self._states.get(session_id)
            if state is None:
                state = SharedState(session_id)
                self._states[session_id] = state
            return state

    def discard(self, session_id: str) -> None:
        with self._lock:
            self._states.pop(session_id, None)


# Singleton — used by the orchestrator
SHARED_STATES = SharedStateManager()
