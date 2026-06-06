"""
SessionContextBridge — L2 → L3 Memory Bridge (ADR-001, AI_WORKSPACE_ARCHITECTURE §3.1)

At the end of each orchestrator session, extracts findings from the SharedState
blackboard and persists them to NodeCognitiveContextModel so future sessions on
the same BPM node inherit accumulated knowledge.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.cognitive.shared_state import SharedState
from app.core.logging import get_logger
from app.models.node_cognitive_context import NodeCognitiveContextModel

logger = get_logger(__name__)

# Topics that carry durable findings worth persisting across sessions
_FINDING_TOPICS = {
    "hypothesis", "risk", "bottleneck", "lean_waste", "kpi",
    "recommendation", "insight", "decision", "improvement",
    "six_sigma", "toc", "final_synthesis",
}

# Topics to extract as key_facts (short textual knowledge)
_FACT_TOPICS = {"node_context", "stakeholder", "actor", "objective"}

# Maximum number of entries to keep per category (prevents unbounded growth)
_MAX_FINDINGS = 50
_MAX_FACTS = 30
_MAX_QUESTIONS = 20


class SessionContextBridge:
    """Connects the per-session SharedState (L2) with the persistent
    NodeCognitiveContext (L3) for a BPM node."""

    @staticmethod
    def extract_and_persist(
        *,
        session_id: str,
        process_case_id: str,
        shared_state: SharedState,
        db: Session,
    ) -> NodeCognitiveContextModel:
        """Extract durable findings from the blackboard and upsert the node context.

        Returns the updated (or newly created) NodeCognitiveContextModel.
        """
        new_findings = SessionContextBridge._extract_findings(shared_state)
        new_facts = SessionContextBridge._extract_facts(shared_state)
        new_questions = SessionContextBridge._extract_open_questions(shared_state)
        methodologies = SessionContextBridge._extract_methodologies(shared_state)

        ctx = db.get(NodeCognitiveContextModel, process_case_id)

        if ctx is None:
            ctx = NodeCognitiveContextModel(
                id=process_case_id,
                key_facts=json.dumps(new_facts),
                findings=json.dumps(new_findings),
                open_questions=json.dumps(new_questions),
                methodology_applied=json.dumps(methodologies),
                last_session_id=session_id,
                sessions_count=1,
                last_analyzed_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            db.add(ctx)
        else:
            existing_findings: list[dict] = json.loads(ctx.findings or "[]")
            existing_facts: list[str] = json.loads(ctx.key_facts or "[]")
            existing_questions: list[str] = json.loads(ctx.open_questions or "[]")
            existing_methods: list[str] = json.loads(ctx.methodology_applied or "[]")

            # Merge — new entries go first, deduplicate facts/methods by value
            merged_findings = (new_findings + existing_findings)[:_MAX_FINDINGS]
            merged_facts = _dedup(new_facts + existing_facts)[:_MAX_FACTS]
            merged_questions = _dedup(new_questions + existing_questions)[:_MAX_QUESTIONS]
            merged_methods = _dedup(existing_methods + methodologies)

            ctx.findings = json.dumps(merged_findings)
            ctx.key_facts = json.dumps(merged_facts)
            ctx.open_questions = json.dumps(merged_questions)
            ctx.methodology_applied = json.dumps(merged_methods)
            ctx.last_session_id = session_id
            ctx.sessions_count = (ctx.sessions_count or 0) + 1
            ctx.last_analyzed_at = datetime.now(UTC)
            ctx.updated_at = datetime.now(UTC)

        try:
            db.commit()
            logger.info(
                "node_context_persisted",
                node_id=process_case_id,
                session_id=session_id,
                new_findings=len(new_findings),
                new_facts=len(new_facts),
            )
        except Exception:
            db.rollback()
            logger.exception("node_context_persist_failed", node_id=process_case_id)
            raise

        return ctx

    # ── Private extraction helpers ─────────────────────────────────────────────

    @staticmethod
    def _extract_findings(shared_state: SharedState) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        for entry in shared_state.all_entries():
            if entry.topic in _FINDING_TOPICS:
                content = entry.content
                if isinstance(content, str):
                    content = {"text": content}
                findings.append({
                    "topic": entry.topic,
                    "agent": entry.agent,
                    "content": content,
                    "confidence": entry.confidence,
                    "recorded_at": entry.created_at.isoformat(),
                })
        return findings

    @staticmethod
    def _extract_facts(shared_state: SharedState) -> list[str]:
        facts: list[str] = []
        for entry in shared_state.all_entries():
            if entry.topic in _FACT_TOPICS:
                if isinstance(entry.content, str) and entry.content.strip():
                    facts.append(entry.content.strip())
                elif isinstance(entry.content, dict):
                    for v in entry.content.values():
                        if isinstance(v, str) and v.strip():
                            facts.append(v.strip())
        return facts

    @staticmethod
    def _extract_open_questions(shared_state: SharedState) -> list[str]:
        questions: list[str] = []
        for entry in shared_state.all_entries():
            if entry.topic == "open_question":
                if isinstance(entry.content, str):
                    questions.append(entry.content.strip())
                elif isinstance(entry.content, list):
                    questions.extend(str(q).strip() for q in entry.content if q)
        return questions

    @staticmethod
    def _extract_methodologies(shared_state: SharedState) -> list[str]:
        methods: list[str] = []
        for entry in shared_state.all_entries():
            if entry.topic in {"lean_waste", "six_sigma", "toc"}:
                methods.append(entry.topic)
            elif entry.topic == "methodology":
                if isinstance(entry.content, str):
                    methods.append(entry.content)
                elif isinstance(entry.content, list):
                    methods.extend(str(m) for m in entry.content)
        return list(dict.fromkeys(methods))  # stable dedup


def _dedup(items: list[str]) -> list[str]:
    """Deduplicate a list while preserving order."""
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result
