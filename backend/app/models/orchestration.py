from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class OrchestrationRunModel(Base):
    __tablename__ = "orchestration_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("process_cases.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    current_phase_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    context_summary: Mapped[str | None] = mapped_column(Text)
    last_error: Mapped[str | None] = mapped_column(Text)
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

    process_case: Mapped["ProcessCaseModel"] = relationship(back_populates="orchestration_run")
    phases: Mapped[list["OrchestrationPhaseModel"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )
    events: Mapped[list["OrchestrationEventModel"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )


class OrchestrationPhaseModel(Base):
    __tablename__ = "orchestration_phases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("orchestration_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phase_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    phase_key: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    agent_role: Mapped[str] = mapped_column(String(80), nullable=False)
    objective_es: Mapped[str] = mapped_column(Text, nullable=False)
    expected_outputs_es: Mapped[str] = mapped_column(Text, nullable=False)
    quality_checks_es: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    requires_human_checkpoint: Mapped[str] = mapped_column(String(5), nullable=False)
    checkpoint_status: Mapped[str] = mapped_column(String(40), nullable=False)
    checkpoint_reviewer: Mapped[str | None] = mapped_column(String(120))
    checkpoint_comment: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    run: Mapped[OrchestrationRunModel] = relationship(back_populates="phases")


class OrchestrationEventModel(Base):
    __tablename__ = "orchestration_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("orchestration_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phase_number: Mapped[int | None] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    actor: Mapped[str] = mapped_column(String(120), nullable=False)
    message_es: Mapped[str] = mapped_column(Text, nullable=False)
    payload_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    run: Mapped[OrchestrationRunModel] = relationship(back_populates="events")
