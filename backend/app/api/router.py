from fastapi import APIRouter

from app.api.routes import (
    cognitive,
    company,
    governance,
    health,
    process_cases,
)

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(company.router, prefix="/companies", tags=["companies"])
api_router.include_router(process_cases.router, prefix="/process-cases", tags=["process cases"])

# ── Enterprise Cognitive Platform (AI workspace) ─────────────────────────────
api_router.include_router(cognitive.router, prefix="/cognitive", tags=["cognitive"])

# ── Governance: solo se conserva por la autenticación (/governance/auth/login) ─
api_router.include_router(governance.router)
