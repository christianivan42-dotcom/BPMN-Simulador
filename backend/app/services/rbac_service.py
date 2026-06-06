"""RBAC service — Ola 3-D Governance.

Roles (ordered by privilege, highest first):
    admin     → full access, manage users
    architect → read/write processes, BPMN, approvals
    analyst   → read/write analyses; cannot manage users or delete processes
    viewer    → read-only

Password hashing uses SHA-256 + salt (stdlib only). Upgrade to bcrypt in Ola 4
when passlib is added to requirements.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.governance import UserModel, UserRole

# Privilege hierarchy: higher index = more permissions
_ROLE_RANK: dict[str, int] = {
    UserRole.viewer: 0,
    UserRole.analyst: 1,
    UserRole.architect: 2,
    UserRole.admin: 3,
}

# Per-role permission matrix
_PERMISSIONS: dict[str, set[str]] = {
    UserRole.viewer: {
        "process_case:read",
        "bpmn:read",
        "overlay:read",
        "comment:read",
        "approval:read",
        "audit:read_own",
        "ai_explanation:read",
    },
    UserRole.analyst: {
        "process_case:read",
        "process_case:create",
        "process_case:update",
        "bpmn:read",
        "bpmn:create",
        "overlay:read",
        "overlay:create",
        "comment:read",
        "comment:create",
        "comment:update_own",
        "approval:read",
        "approval:create",
        "audit:read_own",
        "ai_explanation:read",
        "ai_explanation:create",
    },
    UserRole.architect: {
        "process_case:read",
        "process_case:create",
        "process_case:update",
        "process_case:delete",
        "bpmn:read",
        "bpmn:create",
        "bpmn:update",
        "overlay:read",
        "overlay:create",
        "overlay:delete",
        "comment:read",
        "comment:create",
        "comment:update_own",
        "comment:delete_own",
        "approval:read",
        "approval:create",
        "approval:resolve",
        "audit:read",
        "ai_explanation:read",
        "ai_explanation:create",
    },
    UserRole.admin: {
        "process_case:read",
        "process_case:create",
        "process_case:update",
        "process_case:delete",
        "bpmn:read",
        "bpmn:create",
        "bpmn:update",
        "bpmn:delete",
        "overlay:read",
        "overlay:create",
        "overlay:delete",
        "comment:read",
        "comment:create",
        "comment:update",
        "comment:delete",
        "approval:read",
        "approval:create",
        "approval:resolve",
        "approval:cancel",
        "audit:read",
        "audit:export",
        "ai_explanation:read",
        "ai_explanation:create",
        "user:read",
        "user:create",
        "user:update",
        "user:delete",
        "user:manage_roles",
    },
}


# ── Password helpers ──────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}:{digest}"


def _verify_password(password: str, hashed: str) -> bool:
    try:
        salt, digest = hashed.split(":", 1)
        return secrets.compare_digest(
            digest,
            hashlib.sha256(f"{salt}{password}".encode()).hexdigest(),
        )
    except ValueError:
        return False


# ── User CRUD ─────────────────────────────────────────────────────────────────

def create_user(
    db: Session,
    *,
    email: str,
    username: str,
    password: str,
    full_name: str | None = None,
    role: str = UserRole.viewer,
) -> UserModel:
    user = UserModel(
        id=str(uuid.uuid4()),
        email=email.lower().strip(),
        username=username.strip(),
        full_name=full_name,
        hashed_password=_hash_password(password),
        role=role,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_id(db: Session, user_id: str) -> UserModel | None:
    return db.get(UserModel, user_id)


def get_user_by_email(db: Session, email: str) -> UserModel | None:
    return db.query(UserModel).filter_by(email=email.lower().strip()).first()


def get_user_by_username(db: Session, username: str) -> UserModel | None:
    return db.query(UserModel).filter_by(username=username.strip()).first()


def list_users(db: Session, *, skip: int = 0, limit: int = 100) -> list[UserModel]:
    return db.query(UserModel).offset(skip).limit(limit).all()


def authenticate_user(db: Session, *, username: str, password: str) -> UserModel | None:
    user = get_user_by_username(db, username)
    if not user or not user.is_active:
        return None
    if not _verify_password(password, user.hashed_password):
        return None
    return user


def update_user_role(db: Session, *, user_id: str, new_role: str) -> UserModel | None:
    user = get_user_by_id(db, user_id)
    if not user:
        return None
    user.role = new_role
    user.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, *, user_id: str, **fields: Any) -> UserModel | None:
    user = get_user_by_id(db, user_id)
    if not user:
        return None
    allowed = {"full_name", "is_active", "role"}
    for k, v in fields.items():
        if k in allowed:
            setattr(user, k, v)
        elif k == "password":
            user.hashed_password = _hash_password(v)
    user.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, *, user_id: str) -> bool:
    user = get_user_by_id(db, user_id)
    if not user:
        return False
    db.delete(user)
    db.commit()
    return True


# ── Permission checks ─────────────────────────────────────────────────────────

def has_permission(user: UserModel, permission: str) -> bool:
    """Return True if the user's role grants the given permission string."""
    return permission in _PERMISSIONS.get(user.role, set())


def require_role(user: UserModel, minimum_role: str) -> bool:
    """Return True if user's role rank >= minimum_role rank."""
    return _ROLE_RANK.get(user.role, -1) >= _ROLE_RANK.get(minimum_role, 999)


def get_permissions(role: str) -> list[str]:
    return sorted(_PERMISSIONS.get(role, set()))
