"""Audit Trail service — Ola 3-D Governance.

Every write action on the platform should call `log_action()` to produce
an immutable audit record. This service is intentionally simple: it only
writes; never updates or deletes rows.
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.governance import AuditTrailModel


def log_action(
    db: Session,
    *,
    actor: str,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    process_case_id: str | None = None,
    diff: dict[str, Any] | None = None,
    description: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    user_id: str | None = None,
) -> AuditTrailModel:
    """Append an immutable audit record.

    Args:
        actor:           Username or system identifier performing the action.
        action:          Semantic verb, e.g. "create", "update", "delete",
                         "approve", "reject", "login", "role_change".
        resource_type:   Domain entity, e.g. "process_case", "bpmn_version",
                         "approval_workflow", "user", "overlay".
        resource_id:     Primary key of the affected resource (optional).
        process_case_id: Scopes the entry to a process case for easy filtering.
        diff:            {"before": {...}, "after": {...}} — serialised to JSON.
        description:     Human-readable summary of what changed.
        ip_address:      Request origin IP (IPv4 or IPv6, max 45 chars).
        user_agent:      HTTP User-Agent header value.
        user_id:         FK to users.id when a platform user performed the action.
    """
    entry = AuditTrailModel(
        id=str(uuid.uuid4()),
        user_id=user_id,
        actor=actor,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        process_case_id=process_case_id,
        diff=json.dumps(diff, default=str) if diff is not None else None,
        description=description,
        ip_address=ip_address,
        user_agent=user_agent,
        created_at=datetime.now(UTC),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def list_audit_trail(
    db: Session,
    *,
    process_case_id: str | None = None,
    actor: str | None = None,
    resource_type: str | None = None,
    action: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[AuditTrailModel]:
    q = db.query(AuditTrailModel)
    if process_case_id:
        q = q.filter(AuditTrailModel.process_case_id == process_case_id)
    if actor:
        q = q.filter(AuditTrailModel.actor == actor)
    if resource_type:
        q = q.filter(AuditTrailModel.resource_type == resource_type)
    if action:
        q = q.filter(AuditTrailModel.action == action)
    return (
        q.order_by(AuditTrailModel.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_audit_entry(db: Session, entry_id: str) -> AuditTrailModel | None:
    return db.get(AuditTrailModel, entry_id)
