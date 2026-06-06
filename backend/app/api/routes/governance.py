"""Governance API — Ola 3-D: RBAC, Audit Trail, AI Explainability.

Endpoints:
  Users       POST/GET/PATCH/DELETE  /governance/users/...
  Auth        POST  /governance/auth/login
  Roles       GET   /governance/roles/{role}/permissions
  Audit Trail GET   /governance/audit/...
  Explainability GET/POST  /governance/explanations/...
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.governance import (
    AiExplanationCreate,
    AiExplanationList,
    AiExplanationRead,
    AuditTrailList,
    AuditTrailRead,
    RolePermissions,
    UserCreate,
    UserLogin,
    UserLoginResponse,
    UserRead,
    UserRoleUpdate,
    UserUpdate,
)
from app.services import audit_service, explainability_service, rbac_service
from app.models.governance import UserRole

router = APIRouter(prefix="/governance", tags=["governance"])

_ALL_ROLES = [r.value for r in UserRole]


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.post(
    "/auth/login",
    response_model=UserLoginResponse,
    summary="Autenticar usuario (username + password)",
)
def login(body: UserLogin, request: Request, db: Session = Depends(get_db)) -> UserLoginResponse:
    user = rbac_service.authenticate_user(db, username=body.username, password=body.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas o usuario inactivo.",
        )
    audit_service.log_action(
        db,
        actor=user.username,
        action="login",
        resource_type="user",
        resource_id=user.id,
        description=f"User {user.username} logged in.",
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent"),
        user_id=user.id,
    )
    return UserLoginResponse(user=UserRead.model_validate(user))


# ── Users ─────────────────────────────────────────────────────────────────────

@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear usuario",
)
def create_user(body: UserCreate, request: Request, db: Session = Depends(get_db)) -> UserRead:
    if body.role not in _ALL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Rol inválido. Valores permitidos: {_ALL_ROLES}",
        )
    if rbac_service.get_user_by_email(db, body.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un usuario con ese email.",
        )
    if rbac_service.get_user_by_username(db, body.username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un usuario con ese username.",
        )
    user = rbac_service.create_user(
        db,
        email=body.email,
        username=body.username,
        password=body.password,
        full_name=body.full_name,
        role=body.role,
    )
    audit_service.log_action(
        db,
        actor="system",
        action="create",
        resource_type="user",
        resource_id=user.id,
        description=f"User {user.username} created with role {user.role}.",
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return UserRead.model_validate(user)


@router.get(
    "/users",
    response_model=list[UserRead],
    summary="Listar usuarios",
)
def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[UserRead]:
    users = rbac_service.list_users(db, skip=skip, limit=limit)
    return [UserRead.model_validate(u) for u in users]


@router.get(
    "/users/{user_id}",
    response_model=UserRead,
    summary="Obtener usuario por ID",
)
def get_user(user_id: str, db: Session = Depends(get_db)) -> UserRead:
    user = rbac_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return UserRead.model_validate(user)


@router.patch(
    "/users/{user_id}",
    response_model=UserRead,
    summary="Actualizar datos del usuario (sin rol)",
)
def update_user(
    user_id: str, body: UserUpdate, request: Request, db: Session = Depends(get_db)
) -> UserRead:
    user = rbac_service.update_user(db, user_id=user_id, **body.model_dump(exclude_none=True))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    audit_service.log_action(
        db,
        actor="system",
        action="update",
        resource_type="user",
        resource_id=user_id,
        description=f"User {user_id} updated.",
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return UserRead.model_validate(user)


@router.patch(
    "/users/{user_id}/role",
    response_model=UserRead,
    summary="Cambiar rol de usuario (solo Admin)",
)
def update_role(
    user_id: str, body: UserRoleUpdate, request: Request, db: Session = Depends(get_db)
) -> UserRead:
    if body.role not in _ALL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Rol inválido. Valores permitidos: {_ALL_ROLES}",
        )
    user = rbac_service.update_user_role(db, user_id=user_id, new_role=body.role)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    audit_service.log_action(
        db,
        actor="system",
        action="role_change",
        resource_type="user",
        resource_id=user_id,
        description=f"User {user_id} role changed to {body.role}.",
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return UserRead.model_validate(user)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar usuario",
)
def delete_user(user_id: str, request: Request, db: Session = Depends(get_db)) -> None:
    deleted = rbac_service.delete_user(db, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    audit_service.log_action(
        db,
        actor="system",
        action="delete",
        resource_type="user",
        resource_id=user_id,
        description=f"User {user_id} deleted.",
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


# ── Role permissions ──────────────────────────────────────────────────────────

@router.get(
    "/roles",
    response_model=list[str],
    summary="Listar todos los roles disponibles",
)
def list_roles() -> list[str]:
    return _ALL_ROLES


@router.get(
    "/roles/{role}/permissions",
    response_model=RolePermissions,
    summary="Obtener permisos de un rol",
)
def get_role_permissions(role: str) -> RolePermissions:
    if role not in _ALL_ROLES:
        raise HTTPException(
            status_code=404,
            detail=f"Rol desconocido. Válidos: {_ALL_ROLES}",
        )
    return RolePermissions(role=role, permissions=rbac_service.get_permissions(role))


# ── Audit Trail ───────────────────────────────────────────────────────────────

@router.get(
    "/audit",
    response_model=AuditTrailList,
    summary="Listar entradas del audit trail",
)
def list_audit(
    process_case_id: str | None = Query(None),
    actor: str | None = Query(None),
    resource_type: str | None = Query(None),
    action: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> AuditTrailList:
    entries = audit_service.list_audit_trail(
        db,
        process_case_id=process_case_id,
        actor=actor,
        resource_type=resource_type,
        action=action,
        skip=skip,
        limit=limit,
    )
    return AuditTrailList(
        items=[AuditTrailRead.model_validate(e) for e in entries],
        total=len(entries),
    )


@router.get(
    "/audit/{entry_id}",
    response_model=AuditTrailRead,
    summary="Obtener entrada de audit trail por ID",
)
def get_audit_entry(entry_id: str, db: Session = Depends(get_db)) -> AuditTrailRead:
    entry = audit_service.get_audit_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entrada de audit no encontrada.")
    return AuditTrailRead.model_validate(entry)


# ── AI Explanations ───────────────────────────────────────────────────────────

@router.post(
    "/explanations",
    response_model=AiExplanationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar explicación de recomendación IA",
)
def create_explanation(
    body: AiExplanationCreate, db: Session = Depends(get_db)
) -> AiExplanationRead:
    record = explainability_service.record_explanation(
        db,
        session_id=body.session_id,
        agent_name=body.agent_name,
        recommendation=body.recommendation,
        reasoning=body.reasoning,
        process_case_id=body.process_case_id,
        evidence=body.evidence,
        methodology=body.methodology,
        bpmn_element_id=body.bpmn_element_id,
        confidence=body.confidence,
    )
    return AiExplanationRead.model_validate(record)


@router.get(
    "/explanations",
    response_model=AiExplanationList,
    summary="Listar explicaciones de IA",
)
def list_explanations(
    process_case_id: str | None = Query(None),
    session_id: str | None = Query(None),
    agent_name: str | None = Query(None),
    methodology: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> AiExplanationList:
    records = explainability_service.list_explanations(
        db,
        process_case_id=process_case_id,
        session_id=session_id,
        agent_name=agent_name,
        methodology=methodology,
        skip=skip,
        limit=limit,
    )
    return AiExplanationList(
        items=[AiExplanationRead.model_validate(r) for r in records],
        total=len(records),
    )


@router.get(
    "/explanations/{explanation_id}",
    response_model=AiExplanationRead,
    summary="Obtener explicación de IA por ID",
)
def get_explanation(explanation_id: str, db: Session = Depends(get_db)) -> AiExplanationRead:
    record = explainability_service.get_explanation(db, explanation_id)
    if not record:
        raise HTTPException(status_code=404, detail="Explicación no encontrada.")
    return AiExplanationRead.model_validate(record)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None
