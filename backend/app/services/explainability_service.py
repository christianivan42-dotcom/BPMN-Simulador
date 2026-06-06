"""AI Explainability service — Ola 3-D Governance.

Stores and retrieves explanations for AI agent recommendations so that users
can understand *why* the system suggested a particular action or finding.

Each explanation is linked to:
  - A cognitive session (session_id)
  - Optionally a process case (process_case_id)
  - The specific agent that generated the recommendation
  - The reasoning chain (full text) + evidence snippets
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.governance import AiExplanationModel


def record_explanation(
    db: Session,
    *,
    session_id: str,
    agent_name: str,
    recommendation: str,
    reasoning: str,
    process_case_id: str | None = None,
    evidence: list[str] | None = None,
    methodology: str | None = None,
    bpmn_element_id: str | None = None,
    confidence: float | None = None,
) -> AiExplanationModel:
    """Persist a new AI explanation record.

    Args:
        session_id:       Cognitive session that produced this explanation.
        agent_name:       Name of the agent (e.g. "lean_agent", "planner").
        recommendation:   Short summary of what was recommended.
        reasoning:        Full reasoning chain / chain-of-thought text.
        process_case_id:  BPM node this explanation belongs to (optional).
        evidence:         List of text snippets used as evidence (optional).
        methodology:      Methodology applied: lean | six_sigma | toc | bpmn | general.
        bpmn_element_id:  BPMN element anchor (e.g. "Task_AprobacionCredito").
        confidence:       Agent confidence score 0.0–1.0 (optional).
    """
    record = AiExplanationModel(
        id=str(uuid.uuid4()),
        session_id=session_id,
        agent_name=agent_name,
        recommendation=recommendation,
        reasoning=reasoning,
        process_case_id=process_case_id,
        evidence=json.dumps(evidence, ensure_ascii=False) if evidence else None,
        methodology=methodology,
        bpmn_element_id=bpmn_element_id,
        confidence=confidence,
        created_at=datetime.now(UTC),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_explanations(
    db: Session,
    *,
    process_case_id: str | None = None,
    session_id: str | None = None,
    agent_name: str | None = None,
    methodology: str | None = None,
    skip: int = 0,
    limit: int = 50,
) -> list[AiExplanationModel]:
    q = db.query(AiExplanationModel)
    if process_case_id:
        q = q.filter(AiExplanationModel.process_case_id == process_case_id)
    if session_id:
        q = q.filter(AiExplanationModel.session_id == session_id)
    if agent_name:
        q = q.filter(AiExplanationModel.agent_name == agent_name)
    if methodology:
        q = q.filter(AiExplanationModel.methodology == methodology)
    return (
        q.order_by(AiExplanationModel.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_explanation(db: Session, explanation_id: str) -> AiExplanationModel | None:
    return db.get(AiExplanationModel, explanation_id)


def extract_from_cognitive_response(
    db: Session,
    *,
    session_id: str,
    process_case_id: str | None,
    agents_invoked: list[str],
    findings: list[dict[str, Any]],
) -> list[AiExplanationModel]:
    """Bulk-persist explanations extracted from a CognitiveResponse.

    Iterates over the findings list and creates one AiExplanationModel per
    finding that carries enough information (agent, recommendation, reasoning).
    """
    records: list[AiExplanationModel] = []
    seen: set[str] = set()

    for finding in findings:
        agent = finding.get("agent", "unknown")
        recommendation = finding.get("finding") or finding.get("recommendation") or ""
        reasoning = finding.get("reasoning") or finding.get("analysis") or ""
        if not recommendation or not reasoning:
            continue

        dedup_key = f"{agent}:{recommendation[:80]}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        evidence_raw = finding.get("evidence")
        evidence = (
            evidence_raw if isinstance(evidence_raw, list) else
            [evidence_raw] if isinstance(evidence_raw, str) else None
        )

        record = record_explanation(
            db,
            session_id=session_id,
            agent_name=agent,
            recommendation=recommendation[:2000],
            reasoning=reasoning[:8000],
            process_case_id=process_case_id,
            evidence=evidence,
            methodology=finding.get("methodology"),
            bpmn_element_id=finding.get("element_id") or finding.get("bpmn_element_id"),
            confidence=finding.get("confidence"),
        )
        records.append(record)

    return records
