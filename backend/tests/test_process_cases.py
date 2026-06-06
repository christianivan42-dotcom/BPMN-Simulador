from fastapi.testclient import TestClient

from app.main import create_app
from app.db.session import reset_db


def test_process_case_can_be_created_and_listed() -> None:
    reset_db()
    client = TestClient(create_app())

    create_response = client.post(
        "/api/v1/process-cases",
        json={
            "name": "Aprobacion de proveedores",
            "area": "Compras",
            "objective": "Levantar el proceso as-is",
            "scope": "Desde solicitud hasta alta del proveedor",
            "owner": "Especialista BPM",
        },
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "Aprobacion de proveedores"
    assert created["status"] == "draft"

    list_response = client.get("/api/v1/process-cases")

    assert list_response.status_code == 200
    assert len(list_response.json()) == 1
    assert list_response.json()[0]["id"] == created["id"]


def test_unknown_process_case_returns_404() -> None:
    reset_db()
    client = TestClient(create_app())

    response = client.get("/api/v1/process-cases/00000000-0000-0000-0000-000000000000")

    assert response.status_code == 404
