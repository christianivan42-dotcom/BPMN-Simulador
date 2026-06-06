from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CompanyModel(Base):
    __tablename__ = "companies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    razon_social: Mapped[str] = mapped_column(String(200), nullable=False)
    nombre_corto: Mapped[str | None] = mapped_column(String(80))
    sector: Mapped[str | None] = mapped_column(String(120))
    tamano: Mapped[str | None] = mapped_column(String(40))  # micro, pequeña, mediana, grande
    mision: Mapped[str | None] = mapped_column(Text)
    vision: Mapped[str | None] = mapped_column(Text)
    valores: Mapped[str | None] = mapped_column(Text)
    objetivos_estrategicos: Mapped[str | None] = mapped_column(Text)  # JSON array de strings
    estrategias: Mapped[str | None] = mapped_column(Text)  # JSON array de strings
    kpis: Mapped[str | None] = mapped_column(Text)  # JSON array de KPIs
    poa: Mapped[str | None] = mapped_column(Text)  # JSON array de actividades del Plan Operativo Anual
    mapa_procesos: Mapped[str | None] = mapped_column(Text)  # JSON array de procesos del mapa
    planificacion_estrategica: Mapped[str | None] = mapped_column(Text)
    # Cadena de Valor de Porter — estructura JSON
    cadena_valor: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
