from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# Tope de tamaño por diagrama. Un BPMN grande con su DI ronda los 100-200 KB;
# 4 MB deja margen de sobra y evita que una petición malformada agote memoria.
MAX_XML_CHARS = 4_000_000


class BpmnDiagramBase(BaseModel):
    name: str = Field(default="Proceso", max_length=200)
    map_item_id: str | None = Field(default=None, max_length=64)


class BpmnDiagramCreate(BpmnDiagramBase):
    company_id: str
    asis_xml: str | None = Field(default=None, max_length=MAX_XML_CHARS)
    tobe_xml: str | None = Field(default=None, max_length=MAX_XML_CHARS)
    sim_config: str | None = None
    position: int | None = None


class BpmnDiagramUpdate(BaseModel):
    """Actualización parcial: solo se tocan los campos presentes.

    `None` significa «no cambiar», no «borrar»: el autoguardado del editor manda
    un único escenario cada vez y no debe pisar el otro.
    """

    name: str | None = Field(default=None, max_length=200)
    map_item_id: str | None = Field(default=None, max_length=64)
    asis_xml: str | None = Field(default=None, max_length=MAX_XML_CHARS)
    tobe_xml: str | None = Field(default=None, max_length=MAX_XML_CHARS)
    sim_config: str | None = None
    position: int | None = None


class BpmnDiagramSummary(BpmnDiagramBase):
    """Metadatos sin el XML — lo que necesita el selector de procesos."""

    id: str
    company_id: str
    position: int
    has_asis: bool
    has_tobe: bool
    updated_at: datetime


class BpmnDiagramRead(BpmnDiagramSummary):
    asis_xml: str | None = None
    tobe_xml: str | None = None
    sim_config: str | None = None


class BpmnDiagramImport(BaseModel):
    """Migración en bloque desde el localStorage del navegador."""

    company_id: str
    diagrams: list[BpmnDiagramCreate] = Field(default_factory=list, max_length=200)
