from fastapi.testclient import TestClient

from app.main import create_app


def test_health_check_returns_service_status() -> None:
    client = TestClient(create_app())

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "Agente BPMS - Experto en Procesos"
    assert body["database"]["status"] == "ok"
    # conftest fuerza el modo demo: sin él, el estado depende de si quien corre
    # los tests tiene API keys en su .env.
    assert body["mock_mode"] is True


def test_health_reports_each_component() -> None:
    client = TestClient(create_app())

    body = client.get("/api/v1/health").json()

    for component in ("database", "llm", "cognitive_agents"):
        assert component in body
        assert body[component]["status"] in {"ok", "degraded", "error"}
