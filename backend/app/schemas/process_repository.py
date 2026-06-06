from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class ArtifactType(StrEnum):
    process_narrative_as_is = "process_narrative_as_is"
    process_narrative_to_be = "process_narrative_to_be"
    bpmn_xml_as_is = "bpmn_xml_as_is"
    bpmn_xml_to_be = "bpmn_xml_to_be"
    interview_notes = "interview_notes"
    transcript = "transcript"
    event_log = "event_log"
    mining_report = "mining_report"
    simulation_parameters = "simulation_parameters"
    simulation_result = "simulation_result"
    improvement_report = "improvement_report"
    final_report = "final_report"
    presentation = "presentation"


class ArtifactVersionStatus(StrEnum):
    draft = "draft"
    in_review = "in_review"
    changes_requested = "changes_requested"
    approved = "approved"
    published = "published"
    superseded = "superseded"
    archived = "archived"
    rejected = "rejected"


class ArtifactDecisionAction(StrEnum):
    submit_for_review = "submit_for_review"
    request_changes = "request_changes"
    approve = "approve"
    publish = "publish"
    reject = "reject"
    archive = "archive"


class EvidenceType(StrEnum):
    interview = "interview"
    document = "document"
    event_log = "event_log"
    process_mining = "process_mining"
    bpmn_activity = "bpmn_activity"
    decision = "decision"
    other = "other"


class ProcessRepositoryResponse(BaseModel):
    id: UUID
    case_id: UUID
    name: str
    artifact_count: int
    created_at: datetime
    updated_at: datetime


class ArtifactVersionResponse(BaseModel):
    id: UUID
    artifact_id: UUID
    version: str
    status: ArtifactVersionStatus
    content: str
    change_summary: str | None
    author: str | None
    content_hash: str
    created_at: datetime


class ArtifactDecisionCreate(BaseModel):
    action: ArtifactDecisionAction
    reviewer: str = Field(min_length=2, max_length=120)
    comment: str | None = Field(default=None, max_length=1200)


class ArtifactDecisionResponse(BaseModel):
    id: UUID
    version_id: UUID
    action: ArtifactDecisionAction
    previous_status: ArtifactVersionStatus
    new_status: ArtifactVersionStatus
    reviewer: str
    comment: str | None
    created_at: datetime


class ArtifactCommentCreate(BaseModel):
    author: str = Field(min_length=2, max_length=120)
    comment: str = Field(min_length=1, max_length=1200)


class ArtifactCommentResponse(BaseModel):
    id: UUID
    version_id: UUID
    author: str
    comment: str
    created_at: datetime


class ArtifactVersionCreate(BaseModel):
    content: str = Field(min_length=1)
    version: str = Field(max_length=40)
    change_summary: str | None = Field(default=None, max_length=1000)
    author: str | None = Field(default=None, max_length=120)


class ArtifactVersionHistoryResponse(BaseModel):
    version: ArtifactVersionResponse
    decisions: list[ArtifactDecisionResponse]
    comments: list[ArtifactCommentResponse]


class ArtifactEvidenceCreate(BaseModel):
    evidence_type: EvidenceType
    source_title: str = Field(min_length=2, max_length=180)
    excerpt: str = Field(min_length=1, max_length=4000)
    activity_ref: str | None = Field(default=None, max_length=180)
    source_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1200)


class ArtifactEvidenceResponse(BaseModel):
    id: UUID
    version_id: UUID
    evidence_type: EvidenceType
    source_title: str
    excerpt: str
    activity_ref: str | None
    source_url: str | None
    notes: str | None
    created_at: datetime


class VersionDiffResponse(BaseModel):
    base_version_id: UUID
    target_version_id: UUID
    base_version: str
    target_version: str
    added_lines: int
    removed_lines: int
    diff: list[str]


class QualityCheckResponse(BaseModel):
    code: str
    label: str
    passed: bool
    detail: str


class ArtifactQualityResponse(BaseModel):
    version_id: UUID
    score: int
    checks: list[QualityCheckResponse]


class ProcessArtifactCreate(BaseModel):
    artifact_type: ArtifactType
    title: str = Field(min_length=3, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    content: str = Field(min_length=1)
    version: str = Field(default="0.1.0", max_length=40)
    change_summary: str | None = Field(default=None, max_length=1000)
    author: str | None = Field(default=None, max_length=120)


class ProcessArtifactResponse(BaseModel):
    id: UUID
    repository_id: UUID
    artifact_type: ArtifactType
    title: str
    description: str | None
    current_version_id: UUID | None
    created_at: datetime
    updated_at: datetime
    versions: list[ArtifactVersionResponse]
