from pydantic import BaseModel


class ComponentHealth(BaseModel):
    status: str          # "ok" | "degraded" | "error"
    detail: str = ""


class HealthResponse(BaseModel):
    status: str          # "ok" | "degraded" | "error"
    service: str
    version: str
    environment: str
    # Detailed component checks (only present in /health?detailed=true or always)
    database: ComponentHealth | None = None
    llm: ComponentHealth | None = None
    mock_mode: bool | None = None
    cognitive_agents: ComponentHealth | None = None
