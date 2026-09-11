from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class OverlayType(StrEnum):
    lean = "lean"
    six_sigma = "six_sigma"
    toc = "toc"
    kpi = "kpi"
    risk = "risk"


class BpmnOverlayModel(Base):
    """Analytical overlay layer on top of a BPMN version.

    Overlays annotate specific elements (by BPMN element ID) without
    modifying the base XML — ADR-002.
    """

    __tablename__ = "bpmn_overlays"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)

    # FK to the artifact version that holds the BPMN XML
    artifact_version_id: Mapped[str] = mapped_column(
        ForeignKey("artifact_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    overlay_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)

    # BPMN element this overlay annotates (e.g. "Task_AprobacionCredito")
    element_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # Methodology-specific payload stored as JSON text
    data: Mapped[str] = mapped_column(Text, nullable=False)

    # Visual hints for the frontend (badge_color, icon, tooltip) as JSON text
    visual: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

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

    artifact_version: Mapped["ArtifactVersionModel"] = relationship(  # noqa: F821
        foreign_keys=[artifact_version_id],
    )
