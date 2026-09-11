"""Tests de la API de diagramas BPMN.

Cubre la persistencia que sustituyó al almacenamiento exclusivo en localStorage.
"""
from fastapi.testclient import TestClient

from app.db.session import reset_db
from app.main import create_app

STARTER = '<?xml version="1.0"?><bpmn:definitions/>'


def _client_and_company() -> tuple[TestClient, str]:
    reset_db()
    client = TestClient(create_app())
    response = client.post("/api/v1/companies", json={"razon_social": "Empresa de prueba"})
    assert response.status_code == 201
    return client, response.json()["id"]


def test_diagram_crud_roundtrip() -> None:
    client, company_id = _client_and_company()

    created = client.post(
        "/api/v1/bpmn-diagrams",
        json={"company_id": company_id, "name": "Compras", "asis_xml": STARTER},
    )
    assert created.status_code == 201
    diagram = created.json()
    assert diagram["name"] == "Compras"
    assert diagram["has_asis"] is True
    assert diagram["has_tobe"] is False

    listed = client.get("/api/v1/bpmn-diagrams", params={"company_id": company_id})
    assert listed.status_code == 200
    assert [d["id"] for d in listed.json()] == [diagram["id"]]
    # El listado es solo metadatos: no arrastra el XML.
    assert "asis_xml" not in listed.json()[0]

    fetched = client.get(f"/api/v1/bpmn-diagrams/{diagram['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["asis_xml"] == STARTER

    deleted = client.delete(f"/api/v1/bpmn-diagrams/{diagram['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/bpmn-diagrams/{diagram['id']}").status_code == 404


def test_partial_update_does_not_wipe_the_other_scenario() -> None:
    """El autoguardado manda un solo escenario; el otro debe sobrevivir."""
    client, company_id = _client_and_company()
    diagram_id = client.post(
        "/api/v1/bpmn-diagrams",
        json={"company_id": company_id, "name": "Ventas", "asis_xml": "<asis/>"},
    ).json()["id"]

    updated = client.patch(f"/api/v1/bpmn-diagrams/{diagram_id}", json={"tobe_xml": "<tobe/>"})

    assert updated.status_code == 200
    assert updated.json()["asis_xml"] == "<asis/>"
    assert updated.json()["tobe_xml"] == "<tobe/>"


def test_diagrams_are_scoped_to_their_company() -> None:
    client, company_a = _client_and_company()
    company_b = client.post("/api/v1/companies", json={"razon_social": "Otra"}).json()["id"]
    client.post("/api/v1/bpmn-diagrams", json={"company_id": company_a, "name": "De A"})

    assert len(client.get("/api/v1/bpmn-diagrams", params={"company_id": company_a}).json()) == 1
    assert client.get("/api/v1/bpmn-diagrams", params={"company_id": company_b}).json() == []


def test_import_migrates_browser_diagrams_once() -> None:
    """La migración desde localStorage no debe duplicar nada si se repite."""
    client, company_id = _client_and_company()
    payload = {
        "company_id": company_id,
        "diagrams": [
            {"company_id": company_id, "name": "Uno", "asis_xml": "<a/>"},
            {"company_id": company_id, "name": "Dos", "tobe_xml": "<b/>"},
        ],
    }

    first = client.post("/api/v1/bpmn-diagrams/import", json=payload)
    assert first.status_code == 200
    assert [d["name"] for d in first.json()] == ["Uno", "Dos"]

    # Segunda pasada (p. ej. otra pestaña migrando a la vez): sin duplicados.
    second = client.post("/api/v1/bpmn-diagrams/import", json=payload)
    assert second.status_code == 200
    assert len(second.json()) == 2
    assert len(client.get("/api/v1/bpmn-diagrams", params={"company_id": company_id}).json()) == 2


def test_missing_diagram_returns_problem_details() -> None:
    client, _ = _client_and_company()

    response = client.get("/api/v1/bpmn-diagrams/no-existe")

    assert response.status_code == 404
    assert response.json()["detail"] == "Diagrama no encontrado"


def test_governance_endpoints_are_gone() -> None:
    """El API de usuarios sin autenticar se eliminó; no debe volver por descuido."""
    client, _ = _client_and_company()

    assert client.get("/api/v1/governance/users").status_code == 404
    assert client.post(
        "/api/v1/governance/auth/login", json={"username": "admin", "password": "admin1234"}
    ).status_code == 404
