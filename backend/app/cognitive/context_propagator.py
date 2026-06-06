"""
Context Propagator — Ola 1-B

Propagates strategic context downward from a parent BPM node to a child node
when the child is created.  The child's NodeCognitiveContextModel.inherited_context
is populated with the parent's key_facts, objectives, actors, constraints and
relevant KPIs so that agents start with awareness of the parent's strategy.

Implements §6.1 of AI_WORKSPACE_ARCHITECTURE.md (propagación padre → hijo).
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.node_cognitive_context import NodeCognitiveContextModel
from app.models.process_case import ProcessCaseModel

log = logging.getLogger(__name__)

# Fields that flow downward from parent context to child's inherited_context
_PROPAGATED_FIELDS: tuple[str, ...] = (
    "key_facts",
    "findings",         # only strategic / high-severity findings
    "methodology_applied",
)

# Maximum number of findings to carry forward (avoid bloating child context)
_MAX_INHERITED_FINDINGS = 10


def propagate_down(parent_id: str, child_id: str, db: Session) -> bool:
    """Copy strategic context from *parent_id* into the child node's inherited_context.

    Returns True if inheritance was written, False if parent has no cognitive
    context (nothing to propagate) or any error occurred.

    This function is idempotent: calling it again will overwrite the previous
    inherited_context of the child (the parent is always the authoritative source).
    """
    try:
        parent_case = db.get(ProcessCaseModel, parent_id)
        if parent_case is None:
            return False

        parent_ctx = db.get(NodeCognitiveContextModel, parent_id)
        if parent_ctx is None:
            # Parent has no cognitive history yet — nothing to propagate
            return False

        inherited: dict[str, Any] = {
            "propagated_from": parent_id,
            "parent_name": parent_case.name,
            "parent_level": parent_case.level,
            "parent_objective": parent_case.objective,
            "parent_area": parent_case.area,
            "parent_scope": parent_case.scope,
            "parent_owner": parent_case.owner,
            "propagated_at": datetime.now(UTC).isoformat(),
        }

        # key_facts
        raw_facts = _load_json_list(parent_ctx.key_facts)
        if raw_facts:
            inherited["key_facts"] = raw_facts

        # strategic findings (carry top-N by recency/importance)
        raw_findings = _load_json_list(parent_ctx.findings)
        if raw_findings:
            strategic = _filter_strategic(raw_findings)
            inherited["strategic_findings"] = strategic[:_MAX_INHERITED_FINDINGS]

        # methodologies the parent has already applied
        raw_methods = _load_json_list(parent_ctx.methodology_applied)
        if raw_methods:
            inherited["parent_methodology_applied"] = raw_methods

        # Upsert the child's NodeCognitiveContextModel
        child_ctx = db.get(NodeCognitiveContextModel, child_id)
        if child_ctx is None:
            child_ctx = NodeCognitiveContextModel(
                id=child_id,
                inherited_context=json.dumps(inherited, ensure_ascii=False),
                sessions_count=0,
            )
            db.add(child_ctx)
        else:
            child_ctx.inherited_context = json.dumps(inherited, ensure_ascii=False)
            child_ctx.updated_at = datetime.now(UTC)

        db.commit()
        log.info(
            "context_propagator: inherited context propagated",
            extra={"parent_id": parent_id, "child_id": child_id},
        )
        return True

    except Exception:
        log.exception(
            "context_propagator: failed to propagate context",
            extra={"parent_id": parent_id, "child_id": child_id},
        )
        db.rollback()
        return False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_json_list(raw: str | None) -> list:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _filter_strategic(findings: list[dict]) -> list[dict]:
    """Keep only findings that are relevant at a strategic (parent) level.

    Prefers findings tagged as risk, bottleneck, kpi, recommendation, or
    final_synthesis.  Falls back to all findings if none match.
    """
    strategic_topics = {"risk", "bottleneck", "kpi", "recommendation", "final_synthesis"}
    strategic = [
        f for f in findings
        if isinstance(f, dict) and f.get("topic") in strategic_topics
    ]
    return strategic if strategic else findings
