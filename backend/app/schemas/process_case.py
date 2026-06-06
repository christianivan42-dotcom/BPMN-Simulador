from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class ProcessCaseStatus(StrEnum):
    draft = "draft"
    knowledge_loading = "knowledge_loading"
    discovery = "discovery"
    event_log_analysis = "event_log_analysis"
    as_is_drafting = "as_is_drafting"
    bpmn_drafting = "bpmn_drafting"
    repository_review = "repository_review"
    human_review = "human_review"
    approved_as_is = "approved_as_is"
    improvement_analysis = "improvement_analysis"
    closed = "closed"


class ProcessType(StrEnum):
    proceso = "proceso"
    subproceso = "subproceso"
    procedimiento = "procedimiento"
    actividad = "actividad"
    instructivo = "instructivo"
    registro = "registro"
    politica = "politica"
    indicador = "indicador"


class MapStatus(StrEnum):
    identificado = "identificado"
    documentado = "documentado"
    analizado = "analizado"
    optimizado = "optimizado"
    sin_tobe = "sin_tobe"


class AnalysisStatus(StrEnum):
    """Estado del pipeline de análisis para un nodo del árbol."""
    pendiente = "pendiente"
    descompuesto = "descompuesto"
    en_analisis = "en_analisis"
    analizado_completo = "analizado_completo"
    agregado = "agregado"
    bloqueado = "bloqueado"


class Staleness(StrEnum):
    """Obsolescencia del análisis respecto a cambios en hijos o propio."""
    ok = "ok"
    hijos_modificados = "hijos_modificados"
    propio_modificado = "propio_modificado"
    metricas_obsoletas = "metricas_obsoletas"


class ProcessCaseCreate(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    area: str | None = Field(default=None, max_length=120)
    objective: str | None = Field(default=None, max_length=500)
    scope: str | None = Field(default=None, max_length=1200)
    owner: str | None = Field(default=None, max_length=120)
    process_type: ProcessType | None = None
    level: int | None = Field(default=1, ge=0, le=6)
    parent_id: str | None = None
    transversal: bool = False
    related_macro_ids: list[str] | None = None


class ProcessCaseBulkCreate(BaseModel):
    """Crea múltiples procesos N2 desde los macro-procesos confirmados."""
    items: list[ProcessCaseCreate]


class ProcessCaseResponse(BaseModel):
    id: UUID
    name: str
    area: str | None
    objective: str | None
    scope: str | None
    owner: str | None
    status: ProcessCaseStatus
    process_type: ProcessType | None
    level: int | None
    parent_id: str | None
    map_status: MapStatus
    analysis_status: AnalysisStatus
    staleness: Staleness
    staleness_reason: str | None
    staleness_since: datetime | None
    last_analyzed_at: datetime | None
    transversal: bool
    related_macro_ids: list[str]
    created_at: datetime
    updated_at: datetime


class ProcessCaseTreeNode(BaseModel):
    """Nodo en la representación arbórea — incluye hijos recursivamente."""
    id: UUID
    name: str
    area: str | None  # Para N1 macros: "Estratégico"/"Operativo"/"Soporte"
    level: int | None
    parent_id: str | None
    process_type: ProcessType | None
    analysis_status: AnalysisStatus
    staleness: Staleness
    transversal: bool
    children: list["ProcessCaseTreeNode"] = []
