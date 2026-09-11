from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ProcessCaseModel(Base):
    __tablename__ = "process_cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    area: Mapped[str | None] = mapped_column(String(120))
    objective: Mapped[str | None] = mapped_column(String(500))
    scope: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    process_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    level: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)
    parent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    map_status: Mapped[str] = mapped_column(String(40), nullable=False, default="identificado")
    # ── Análisis jerárquico bottom-up ─────────────────────────────────────────
    # Estados: pendiente | descompuesto | en_analisis | analizado_completo | agregado | bloqueado
    analysis_status: Mapped[str] = mapped_column(String(30), nullable=False, default="pendiente")
    # Obsolescencia: ok | hijos_modificados | propio_modificado | metricas_obsoletas
    staleness: Mapped[str] = mapped_column(String(30), nullable=False, default="ok")
    staleness_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    staleness_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Identifica procesos transversales (presentes en múltiples macro-procesos)
    transversal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # IDs de macro-procesos adicionales separados por coma (cuando es transversal)
    related_macro_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Cadenas de flujo entre hijos N2 (solo aplica a N1 macro-procesos)
    # JSON serializado: [["n2-id-a","n2-id-b"], ["n2-id-c"]]
    # Cada lista interna es una cadena; lista de 1 elemento = proceso independiente.
    flow_definition: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ──────────────────────────────────────────────────────────────────────────
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

    repository: Mapped["ProcessRepositoryModel"] = relationship(
        back_populates="process_case",
        cascade="all, delete-orphan",
        uselist=False,
    )
    stakeholders: Mapped[list["ProcessStakeholderModel"]] = relationship(
        back_populates="process_case",
        cascade="all, delete-orphan",
    )
    interviews: Mapped[list["ProcessInterviewModel"]] = relationship(
        back_populates="process_case",
        cascade="all, delete-orphan",
    )
    as_is_elements: Mapped[list["ProcessAsIsElementModel"]] = relationship(
        back_populates="process_case",
        cascade="all, delete-orphan",
    )
    orchestration_run: Mapped["OrchestrationRunModel"] = relationship(
        back_populates="process_case",
        cascade="all, delete-orphan",
        uselist=False,
    )
