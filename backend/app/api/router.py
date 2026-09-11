from fastapi import APIRouter

from app.api.routes import (
    bpmn_diagrams,
    cognitive,
    company,
    health,
    process_cases,
)

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(company.router, prefix="/companies", tags=["companies"])
api_router.include_router(process_cases.router, prefix="/process-cases", tags=["process cases"])
api_router.include_router(bpmn_diagrams.router, prefix="/bpmn-diagrams", tags=["bpmn diagrams"])

# ── Enterprise Cognitive Platform (AI workspace) ─────────────────────────────
api_router.include_router(cognitive.router, prefix="/cognitive", tags=["cognitive"])
