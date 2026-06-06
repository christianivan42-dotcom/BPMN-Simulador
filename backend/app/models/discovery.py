from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ProcessStakeholderModel(Base):
    __tablename__ = "process_stakeholders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("process_cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(140), nullable=False)
    role: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    area: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(180))
    influence_level: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    availability: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
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

    process_case: Mapped["ProcessCaseModel"] = relationship(back_populates="stakeholders")
    interviews: Mapped[list["ProcessInterviewModel"]] = relationship(back_populates="stakeholder")


class ProcessInterviewModel(Base):
    __tablename__ = "process_interviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("process_cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stakeholder_id: Mapped[str | None] = mapped_column(
        ForeignKey("process_stakeholders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    interview_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    objective: Mapped[str | None] = mapped_column(Text)
    questions: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
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

    process_case: Mapped["ProcessCaseModel"] = relationship(back_populates="interviews")
    stakeholder: Mapped[ProcessStakeholderModel | None] = relationship(back_populates="interviews")
    as_is_elements: Mapped[list["ProcessAsIsElementModel"]] = relationship(
        back_populates="interview",
        cascade="all, delete-orphan",
    )


class ProcessAsIsElementModel(Base):
    __tablename__ = "process_as_is_elements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("process_cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    interview_id: Mapped[str | None] = mapped_column(
        ForeignKey("process_interviews.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    element_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    source_excerpt: Mapped[str | None] = mapped_column(Text)
    confidence_level: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
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

    process_case: Mapped["ProcessCaseModel"] = relationship(back_populates="as_is_elements")
    interview: Mapped[ProcessInterviewModel | None] = relationship(back_populates="as_is_elements")
