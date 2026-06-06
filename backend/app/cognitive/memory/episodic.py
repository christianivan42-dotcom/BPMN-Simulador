"""
Episodic Memory — Specific conversational events.

Stores turn-by-turn interactions: user query, agents involved, tools called,
findings published. Used to reconstruct reasoning chains and for reflection.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


@dataclass
class ConversationTurn:
    id: str
    session_id: str
    user_input: str
    agents_invoked: list[str]
    tools_called: list[str]
    final_response: str
    duration_ms: int
    confidence: float
    feedback: str | None = None  # 'positive', 'negative', 'correction'
    metadata: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "user_input": self.user_input,
            "agents_invoked": self.agents_invoked,
            "tools_called": self.tools_called,
            "final_response": self.final_response,
            "duration_ms": self.duration_ms,
            "confidence": self.confidence,
            "feedback": self.feedback,
            "timestamp": self.timestamp.isoformat(),
        }


class EpisodicMemory:
    """
    In-memory store of conversation episodes.

    Future: persist to DB. For now: per-process, retained until restart.
    """

    def __init__(self) -> None:
        self._turns: list[ConversationTurn] = []
        self._by_session: dict[str, list[ConversationTurn]] = {}

    def record(self, turn: ConversationTurn) -> None:
        self._turns.append(turn)
        self._by_session.setdefault(turn.session_id, []).append(turn)

    def create_turn(
        self,
        session_id: str,
        user_input: str,
        agents_invoked: list[str],
        tools_called: list[str],
        final_response: str,
        duration_ms: int,
        confidence: float = 1.0,
        **meta: Any,
    ) -> ConversationTurn:
        turn = ConversationTurn(
            id=str(uuid4()),
            session_id=session_id,
            user_input=user_input,
            agents_invoked=agents_invoked,
            tools_called=tools_called,
            final_response=final_response,
            duration_ms=duration_ms,
            confidence=confidence,
            metadata=meta,
        )
        self.record(turn)
        return turn

    def session_turns(self, session_id: str, last_n: int | None = None) -> list[ConversationTurn]:
        turns = self._by_session.get(session_id, [])
        return turns[-last_n:] if last_n else list(turns)

    def all_turns(self) -> list[ConversationTurn]:
        return list(self._turns)

    def add_feedback(self, turn_id: str, feedback: str) -> bool:
        for t in self._turns:
            if t.id == turn_id:
                t.feedback = feedback
                return True
        return False

    def to_json(self, session_id: str | None = None) -> str:
        turns = self._by_session.get(session_id, []) if session_id else self._turns
        return json.dumps([t.to_dict() for t in turns], ensure_ascii=False, indent=2)


EPISODIC_MEMORY = EpisodicMemory()
