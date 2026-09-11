"""Persistencia de los diagramas BPMN modelados en el editor.

Hasta ahora los diagramas vivían ÚNICAMENTE en el localStorage del navegador:
se perdían al cambiar de equipo o de navegador, al limpiar los datos de
navegación y —en silencio— al llenarse la cuota. Esta tabla los guarda en el
backend, junto con la configuración de simulación de cada escenario.

Un registro = un proceso modelado, con sus dos escenarios (AS-IS y TO-BE).
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BpmnDiagramModel(Base):
    __tablename__ = "bpmn_diagrams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    company_id: Mapped[str] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False, default="Proceso")
    # Id del ítem del mapa de procesos al que pertenece (campo libre del JSON de
    # la empresa, por eso no es una FK).
    map_item_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    asis_xml: Mapped[str | None] = mapped_column(Text, nullable=True)
    tobe_xml: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Configuración del simulador por escenario, serializada como JSON:
    # {"asis": {...}, "tobe": {...}}. Antes se perdía al cerrar el panel.
    sim_config: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Orden de aparición en el selector de procesos.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
