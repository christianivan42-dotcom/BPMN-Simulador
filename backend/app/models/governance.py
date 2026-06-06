from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class UserRole(StrEnum):
    admin = "admin"
    architect = "architect"
    analyst = "analyst"
    viewer = "viewer"


class UserModel(Base):
    """Platform user with RBAC role assignment."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    username: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        String(40), nullable=False, default=UserRole.viewer, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    audit_entries: Mapped[list["AuditTrailModel"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class AuditTrailModel(Base):
    """Immutable audit log entry for every write action on the platform.

    Captures who, what, when, on which resource, and what changed (diff JSON).
    """

    __tablename__ = "audit_trail"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)

    # Actor — nullable to support system/anonymous actions
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # String fallback when no user row exists (e.g. external service)
    actor: Mapped[str] = mapped_column(String(120), nullable=False, index=True)

    # Semantic action: "create", "update", "delete", "approve", "reject", etc.
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)

    # Resource identification
    resource_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # Optional process_case scope for filtering
    process_case_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # JSON diff payload: {"before": {...}, "after": {...}}
    diff: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Human-readable description of the action
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # HTTP context
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
    )

    user: Mapped["UserModel | None"] = relationship(back_populates="audit_entries")


class AiExplanationModel(Base):
    """Record explaining why an AI agent made a specific recommendation.

    Stored per cognitive session turn, linked to a process_case and optionally
    to an agent name and BPMN element.
    """

    __tablename__ = "ai_explanations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)

    process_case_id: Mapped[str | None] = mapped_column(
        ForeignKey("process_cases.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # Name of the agent that produced the finding
    agent_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)

    # Short summary of the recommendation
    recommendation: Mapped[str] = mapped_column(Text, nullable=False)

    # Full reasoning chain (markdown / plain text)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)

    # Evidence snippets used (JSON list of strings)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Methodology applied: lean | six_sigma | toc | bpmn | general
    methodology: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)

    # Optional anchor to a BPMN element
    bpmn_element_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Confidence score 0-1 (optional, set by the agent when available)
    confidence: Mapped[float | None] = mapped_column(nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
    )
