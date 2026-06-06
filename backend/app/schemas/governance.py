from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, field_validator, model_validator


# ── User schemas ──────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str
    username: str
    password: str
    full_name: str | None = None
    role: str = "viewer"


class UserUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None
    password: str | None = None


class UserRoleUpdate(BaseModel):
    role: str


class UserRead(BaseModel):
    id: str
    email: str
    username: str
    full_name: str | None
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserLogin(BaseModel):
    username: str
    password: str


class UserLoginResponse(BaseModel):
    user: UserRead
    message: str = "Login successful"


# ── Permissions schema ────────────────────────────────────────────────────────

class RolePermissions(BaseModel):
    role: str
    permissions: list[str]


# ── Audit Trail schemas ───────────────────────────────────────────────────────

class AuditTrailRead(BaseModel):
    id: str
    user_id: str | None
    actor: str
    action: str
    resource_type: str
    resource_id: str | None
    process_case_id: str | None
    diff: dict[str, Any] | None
    description: str | None
    ip_address: str | None
    created_at: datetime

    @field_validator("diff", mode="before")
    @classmethod
    def parse_diff(cls, v: Any) -> dict[str, Any] | None:
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, ValueError):
                return None
        return v

    model_config = {"from_attributes": True}


class AuditTrailList(BaseModel):
    items: list[AuditTrailRead]
    total: int


# ── AI Explanation schemas ────────────────────────────────────────────────────

class AiExplanationCreate(BaseModel):
    session_id: str
    agent_name: str
    recommendation: str
    reasoning: str
    process_case_id: str | None = None
    evidence: list[str] | None = None
    methodology: str | None = None
    bpmn_element_id: str | None = None
    confidence: float | None = None


class AiExplanationRead(BaseModel):
    id: str
    session_id: str
    agent_name: str
    recommendation: str
    reasoning: str
    process_case_id: str | None
    evidence: list[str] | None
    methodology: str | None
    bpmn_element_id: str | None
    confidence: float | None
    created_at: datetime

    @field_validator("evidence", mode="before")
    @classmethod
    def parse_evidence(cls, v: Any) -> list[str] | None:
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, ValueError):
                return None
        return v

    model_config = {"from_attributes": True}


class AiExplanationList(BaseModel):
    items: list[AiExplanationRead]
    total: int
