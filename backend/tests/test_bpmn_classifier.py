"""
Tests de la clasificación por contexto de los nodos dibujados en un BPMN.

Cubre:
  · classify_bpmn_node — clasificación unitaria por nombre y por tipo BPMN.
  · detect_and_create_children — desde un mapa N1, una caja "subproceso" se
    clasifica en Proceso (N2) / Procedimiento (N3) / Actividad-Instructivo (N4).
"""
from uuid import uuid4

from app.db.session import SessionLocal, reset_db
from app.models.process_case import ProcessCaseModel
from app.models.process_repository import ProcessRepositoryModel
from app.services.bpmn_level_classifier import (
    child_level_options,
    classify_bpmn_node,
    type_for_level,
)
from app.services.bpmn_subelement_detector import detect_and_create_children


# ── Clasificación unitaria ────────────────────────────────────────────────────

def test_subprocess_sin_pista_desde_n1_es_proceso_n2() -> None:
    r = classify_bpmn_node(tag="subProcess", name="Compras", parent_level=1)
    assert r["process_type"] == "proceso"
    assert r["level"] == 2
    assert r["level_name"] == "Proceso"


def test_nombre_procedimiento_clasifica_n3() -> None:
    r = classify_bpmn_node(tag="subProcess", name="Procedimiento de recepción", parent_level=1)
    assert r["process_type"] == "procedimiento"
    assert r["level"] == 3
    assert r["confidence"] == "alta"


def test_nombre_instructivo_clasifica_n4() -> None:
    r = classify_bpmn_node(tag="subProcess", name="Instructivo de almacenaje", parent_level=1)
    assert r["process_type"] == "instructivo"
    assert r["level"] == 4


def test_nombre_actividad_clasifica_n4() -> None:
    r = classify_bpmn_node(tag="task", name="Actividad de inspección", parent_level=1)
    assert r["process_type"] == "actividad"
    assert r["level"] == 4


def test_callactivity_sin_pista_es_procedimiento_n3() -> None:
    r = classify_bpmn_node(tag="callActivity", name="Validar crédito", parent_level=1)
    assert r["process_type"] == "procedimiento"
    assert r["level"] == 3


def test_tarea_generica_desde_n1_es_proceso_n2() -> None:
    r = classify_bpmn_node(tag="task", name="Gestión de proveedores", parent_level=1)
    assert r["process_type"] == "proceso"
    assert r["level"] == 2


def test_hijo_nunca_queda_mas_arriba_que_el_padre() -> None:
    # Desde un Proceso N2, una caja con pista de "proceso" no puede quedar en N2;
    # se acota a, al menos, un nivel por debajo del padre (N3).
    r = classify_bpmn_node(tag="subProcess", name="Proceso interno", parent_level=2)
    assert r["level"] >= 3


# ── Integración: detección + creación de hijos desde N1 ───────────────────────

_BPMN_N1 = """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <bpmn:process id="P1" isExecutable="false">
    <bpmn:task id="t1" name="Gestión de Compras" />
    <bpmn:subProcess id="sp1" name="Procedimiento de Recepción" />
    <bpmn:userTask id="ut1" name="Instructivo de Almacenaje" />
    <bpmn:callActivity id="ca1" name="Validar Crédito" />
  </bpmn:process>
</bpmn:definitions>
"""


def _seed_macro_n1(db) -> str:
    case = ProcessCaseModel(
        id=str(uuid4()),
        name="Abastecimiento",
        area="Operativo",
        status="draft",
        level=1,
        map_status="identificado",
        analysis_status="pendiente",
    )
    case.repository = ProcessRepositoryModel(
        id=str(uuid4()), case_id=case.id, name="Repo macro",
    )
    db.add(case)
    db.commit()
    return case.id


def test_detecta_y_clasifica_hijos_desde_mapa_n1() -> None:
    reset_db()
    db = SessionLocal()
    try:
        macro_id = _seed_macro_n1(db)
        result = detect_and_create_children(db, macro_id, _BPMN_N1)

        by_name = {c["name"]: c for c in result["created"]}
        assert by_name["Gestión de Compras"]["level"] == 2          # proceso → N2
        assert by_name["Procedimiento de Recepción"]["level"] == 3  # procedimiento → N3
        assert by_name["Instructivo de Almacenaje"]["level"] == 4   # instructivo → N4
        assert by_name["Validar Crédito"]["level"] == 3             # callActivity → N3

        # Cada creado trae su explicación de por qué se clasificó así.
        assert all(c.get("rationale") for c in result["created"])

        # Resumen por nivel: N2=1, N3=2, N4=1
        summary = {g["level"]: g["count"] for g in result["classification"]}
        assert summary == {2: 1, 3: 2, 4: 1}
    finally:
        db.close()


# ── Helpers nivel ↔ tipo (reclasificación manual) ─────────────────────────────

def test_type_for_level_usa_default_y_conserva_familia() -> None:
    assert type_for_level(2) == "proceso"
    assert type_for_level(3) == "procedimiento"
    assert type_for_level(4) == "actividad"
    # 'instructivo' ya es N4 → se conserva en vez de forzar 'actividad'
    assert type_for_level(4, "instructivo") == "instructivo"
    # 'proceso' no pertenece a N3 → se reemplaza por el default del nivel
    assert type_for_level(3, "proceso") == "procedimiento"


def test_child_level_options_siempre_mas_profundo_que_el_padre() -> None:
    opts_n1 = [o["level"] for o in child_level_options(1)]
    assert opts_n1[0] == 2 and 1 not in opts_n1
    opts_n2 = [o["level"] for o in child_level_options(2)]
    assert opts_n2[0] == 3 and 2 not in opts_n2


def test_deteccion_es_idempotente() -> None:
    reset_db()
    db = SessionLocal()
    try:
        macro_id = _seed_macro_n1(db)
        first = detect_and_create_children(db, macro_id, _BPMN_N1)
        assert len(first["created"]) == 4

        second = detect_and_create_children(db, macro_id, _BPMN_N1)
        assert second["created"] == []
        assert second["skipped_existing"] == 4
    finally:
        db.close()
