from fastapi import APIRouter

from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.health import ComponentHealth, HealthResponse

router = APIRouter()
logger = get_logger(__name__)


def _check_database() -> ComponentHealth:
    try:
        from sqlalchemy import text
        from app.db.session import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_type = "postgresql" if settings.use_postgres else "sqlite"
        return ComponentHealth(status="ok", detail=db_type)
    except Exception as exc:  # noqa: BLE001
        logger.warning("health.db_check_failed", error=str(exc))
        return ComponentHealth(status="error", detail=str(exc)[:200])


def _check_llm() -> ComponentHealth:
    if settings.use_mock_llm:
        return ComponentHealth(status="ok", detail="mock mode active")

    configured: list[str] = []
    if settings.gemini_api_key:
        configured.append("gemini")
    if settings.groq_api_key:
        configured.append("groq")
    if settings.deepseek_api_key:
        configured.append("deepseek")

    if not configured:
        return ComponentHealth(
            status="degraded",
            detail="no LLM API keys configured — set GEMINI_API_KEY, GROQ_API_KEY, or DEEPSEEK_API_KEY",
        )
    return ComponentHealth(status="ok", detail=f"providers: {', '.join(configured)}")


def _check_cognitive_agents() -> ComponentHealth:
    try:
        from app.cognitive.agents.registry import AgentRegistry

        registry = AgentRegistry()
        count = len(registry.all_agents())
        return ComponentHealth(status="ok", detail=f"{count} agents registered")
    except Exception as exc:  # noqa: BLE001
        logger.warning("health.agents_check_failed", error=str(exc))
        return ComponentHealth(status="error", detail=str(exc)[:200])


@router.get("", response_model=HealthResponse)
def health_check() -> HealthResponse:
    db = _check_database()
    llm = _check_llm()
    agents = _check_cognitive_agents()

    overall = "ok"
    if any(c.status == "error" for c in [db, llm, agents]):
        overall = "error"
    elif any(c.status == "degraded" for c in [db, llm, agents]):
        overall = "degraded"

    return HealthResponse(
        status=overall,
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
        database=db,
        llm=llm,
        mock_mode=settings.use_mock_llm,
        cognitive_agents=agents,
    )
