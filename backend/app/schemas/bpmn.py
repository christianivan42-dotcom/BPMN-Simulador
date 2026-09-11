import json
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class BpmnIssueSeverity(StrEnum):
    info = "info"
    warning = "warning"
    error = "error"


class BpmnIssueResponse(BaseModel):
    severity: BpmnIssueSeverity
    code: str
    message_es: str
    element_ref: str | None = None


class BpmnDraftResponse(BaseModel):
    case_id: UUID
    source_element_count: int
    task_count: int
    gateway_count: int
    bpmn_xml: str
    issues: list[BpmnIssueResponse]
    is_valid: bool
    artifact_id: UUID | None = None
    artifact_version_id: UUID | None = None


class BpmnGenerateCreate(BaseModel):
    title: str = Field(default="BPMN as-is generado por agente", min_length=3, max_length=180)
    author: str | None = Field(default="Agente Modelador BPMN", max_length=120)
    persist: bool = True


class BpmnValidationCreate(BaseModel):
    bpmn_xml: str = Field(min_length=20)


class BpmnValidationResponse(BaseModel):
    is_valid: bool
    issues: list[BpmnIssueResponse]


# ── Overlay schemas ───────────────────────────────────────────────────────────

class OverlayTypeEnum(StrEnum):
    lean = "lean"
    six_sigma = "six_sigma"
    toc = "toc"
    kpi = "kpi"
    risk = "risk"


class BpmnOverlayCreate(BaseModel):
    element_id: str = Field(min_length=1, max_length=255, description="ID del elemento BPMN anotado")
    data: dict = Field(description="Payload específico de la metodología")
    visual: dict | None = Field(default=None, description="Hints visuales: badge_color, icon, tooltip")
    created_by: str | None = Field(default=None, max_length=120)


class BpmnOverlayResponse(BaseModel):
    id: UUID
    artifact_version_id: UUID
    overlay_type: OverlayTypeEnum
    element_id: str
    data: dict
    visual: dict | None
    created_by: str | None
    created_at: datetime
    updated_at: datetime

    @field_validator("data", mode="before")
    @classmethod
    def parse_data(cls, v: object) -> object:
        if isinstance(v, str):
            return json.loads(v)
        return v

    @field_validator("visual", mode="before")
    @classmethod
    def parse_visual(cls, v: object) -> object:
        if isinstance(v, str):
            return json.loads(v)
        return v

    model_config = {"from_attributes": True}


class BpmnOverlayListResponse(BaseModel):
    overlays: list[BpmnOverlayResponse]
    total: int
