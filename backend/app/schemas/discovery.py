from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class StakeholderRole(StrEnum):
    process_owner = "process_owner"
    subject_matter_expert = "subject_matter_expert"
    approver = "approver"
    participant = "participant"
    system_owner = "system_owner"
    risk_control = "risk_control"
    external = "external"


class StakeholderInfluenceLevel(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"


class InterviewType(StrEnum):
    discovery = "discovery"
    validation = "validation"
    workshop = "workshop"
    observation = "observation"
    follow_up = "follow_up"


class InterviewStatus(StrEnum):
    planned = "planned"
    scheduled = "scheduled"
    completed = "completed"
    cancelled = "cancelled"


class AsIsElementType(StrEnum):
    activity = "activity"
    role = "role"
    event = "event"
    business_rule = "business_rule"
    system = "system"
    input_output = "input_output"
    exception = "exception"
    pain_point = "pain_point"
    opportunity = "opportunity"
    metric = "metric"
    control = "control"


class ConfidenceLevel(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"


class ProcessStakeholderCreate(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    role: StakeholderRole = StakeholderRole.participant
    area: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=180)
    influence_level: StakeholderInfluenceLevel = StakeholderInfluenceLevel.medium
    availability: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=1200)


class ProcessStakeholderResponse(BaseModel):
    id: UUID
    case_id: UUID
    name: str
    role: StakeholderRole
    area: str | None
    email: str | None
    influence_level: StakeholderInfluenceLevel
    availability: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class ProcessInterviewCreate(BaseModel):
    stakeholder_id: UUID | None = None
    title: str = Field(min_length=3, max_length=180)
    interview_type: InterviewType = InterviewType.discovery
    status: InterviewStatus = InterviewStatus.planned
    scheduled_at: datetime | None = None
    objective: str | None = Field(default=None, max_length=1600)
    questions: str | None = Field(default=None, max_length=5000)
    notes: str | None = Field(default=None, max_length=5000)
    summary: str | None = Field(default=None, max_length=5000)


class ProcessInterviewResponse(BaseModel):
    id: UUID
    case_id: UUID
    stakeholder_id: UUID | None
    stakeholder_name: str | None
    title: str
    interview_type: InterviewType
    status: InterviewStatus
    scheduled_at: datetime | None
    objective: str | None
    questions: str | None
    notes: str | None
    summary: str | None
    created_at: datetime
    updated_at: datetime


class InterviewGuideSection(BaseModel):
    title: str
    questions: list[str]


class InterviewGuideResponse(BaseModel):
    case_id: UUID
    title: str
    sections: list[InterviewGuideSection]


class ProcessAsIsElementCreate(BaseModel):
    interview_id: UUID | None = None
    element_type: AsIsElementType
    name: str = Field(min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    source_excerpt: str | None = Field(default=None, max_length=2000)
    confidence_level: ConfidenceLevel = ConfidenceLevel.medium
    created_by: str = Field(default="human", max_length=80)


class ProcessAsIsElementResponse(BaseModel):
    id: UUID
    case_id: UUID
    interview_id: UUID | None
    interview_title: str | None
    element_type: AsIsElementType
    name: str
    description: str | None
    source_excerpt: str | None
    confidence_level: ConfidenceLevel
    created_by: str
    created_at: datetime
    updated_at: datetime


class DiscoveryQuestionResponse(BaseModel):
    role: StakeholderRole
    priority: str
    question_es: str
    reason_es: str
    expected_evidence_es: str


class DiscoveryGapResponse(BaseModel):
    code: str
    severity: str
    title_es: str
    detail_es: str
    recommendation_es: str


class DiscoveryContradictionResponse(BaseModel):
    topic: str
    severity: str
    evidence_es: list[str]
    recommendation_es: str


class DiscoveryCompletenessDimensionResponse(BaseModel):
    code: str
    label_es: str
    score: int
    max_score: int
    status: str
    detail_es: str


class DiscoveryAssessmentResponse(BaseModel):
    case_id: UUID
    readiness_level: str
    completeness_score: int
    dimensions: list[DiscoveryCompletenessDimensionResponse]
    generated_questions: list[DiscoveryQuestionResponse]
    gaps: list[DiscoveryGapResponse]
    contradictions: list[DiscoveryContradictionResponse]
    next_actions_es: list[str]
