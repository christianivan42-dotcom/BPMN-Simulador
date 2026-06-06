"""
Semantic Memory — Learned facts and generalizations.

Stores abstract knowledge derived from many episodes:
    - "El proceso de Compras suele tener cuellos en aprobación de >$10K"
    - "Cuando el usuario menciona 'lento', habitualmente busca análisis de tiempos"
    - "Métrica X correlaciona con problema Y"

These are produced by the LearningAgent through reflection over episodic memory.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


@dataclass
class LearnedFact:
    id: str
    statement: str  # the learned fact in natural language
    topic: str  # e.g. "process_pattern", "user_preference", "kpi_correlation"
    confidence: float  # 0..1
    support_count: int  # how many episodes support it
    evidence_turn_ids: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    last_reinforced_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class SemanticMemory:
    """
    Stores learned patterns and abstractions.

    The LearningAgent periodically reflects over episodic memory and
    consolidates patterns here. Facts can be reinforced (confidence ↑)
    or contradicted (confidence ↓).
    """

    def __init__(self) -> None:
        self._facts: list[LearnedFact] = []

    def add(
        self,
        statement: str,
        topic: str,
        *,
        confidence: float = 0.5,
        evidence: list[str] | None = None,
        tags: list[str] | None = None,
    ) -> LearnedFact:
        fact = LearnedFact(
            id=str(uuid4()),
            statement=statement,
            topic=topic,
            confidence=confidence,
            support_count=len(evidence or []),
            evidence_turn_ids=evidence or [],
            tags=tags or [],
        )
        self._facts.append(fact)
        return fact

    def reinforce(self, fact_id: str, additional_evidence: list[str] | None = None) -> bool:
        for f in self._facts:
            if f.id == fact_id:
                f.support_count += 1
                if additional_evidence:
                    f.evidence_turn_ids.extend(additional_evidence)
                f.confidence = min(1.0, f.confidence + 0.05)
                f.last_reinforced_at = datetime.now(UTC)
                return True
        return False

    def weaken(self, fact_id: str) -> bool:
        for f in self._facts:
            if f.id == fact_id:
                f.confidence = max(0.0, f.confidence - 0.1)
                return True
        return False

    def search(self, query_terms: list[str], min_confidence: float = 0.3) -> list[LearnedFact]:
        """Naive keyword overlap search — replace with embedding similarity later."""
        ql = [t.lower() for t in query_terms]
        results = []
        for f in self._facts:
            if f.confidence < min_confidence:
                continue
            s = f.statement.lower()
            if any(t in s for t in ql) or any(t in f.tags for t in ql):
                results.append(f)
        return sorted(results, key=lambda r: -r.confidence)

    def by_topic(self, topic: str) -> list[LearnedFact]:
        return [f for f in self._facts if f.topic == topic]

    def all_facts(self, min_confidence: float = 0.0) -> list[LearnedFact]:
        return [f for f in self._facts if f.confidence >= min_confidence]

    def prune(self, min_confidence: float = 0.1) -> int:
        """Memory consolidation: remove low-confidence facts."""
        before = len(self._facts)
        self._facts = [f for f in self._facts if f.confidence >= min_confidence]
        return before - len(self._facts)


SEMANTIC_MEMORY = SemanticMemory()
