"""
Tests de la reclasificación manual de nivel (override del analista) — mantiene la
integridad de la cadena N0→NN al mover un nodo.

NOTA: importa ProcessCaseService, que arrastra `app.cognitive` (structlog). Correr
con el entorno que tenga las dependencias instaladas (backend/venv_mac).
"""
from uuid import UUID, uuid4

import pytest

from app.db.session import SessionLocal, reset_db
from app.models.process_case import ProcessCaseModel
from app.models.process_repository import ProcessRepositoryModel
from app.services.process_case_service import ProcessCaseService


def _seed(db, name: str, level: int, parent_id: str | None = None) -> str:
    case = ProcessCaseModel(
        id=str(uuid4()), name=name, area="Operativo", status="draft",
        level=level, parent_id=parent_id,
        map_status="identificado", analysis_status="pendiente",
    )
    case.repository = ProcessRepositoryModel(id=str(uuid4()), case_id=case.id, name=f"Repo {name}")
    db.add(case)
    db.commit()
    return case.id


def test_reclasificar_nodo_actualiza_nivel_y_tipo() -> None:
    reset_db()
    db = SessionLocal()
    try:
        macro = _seed(db, "Macro", 1)
        child = _seed(db, "Recepcion", 2, parent_id=macro)
        svc = ProcessCaseService(db)

        res = svc.reclassify_case(UUID(child), level=3)
        assert res is not None
        assert res["updated"].level == 3
        assert res["updated"].process_type.value == "procedimiento"
        assert res["descendants_shifted"] == 0
    finally:
        db.close()


def test_reclasificar_desplaza_descendientes_en_cascada() -> None:
    reset_db()
    db = SessionLocal()
    try:
        macro = _seed(db, "Macro", 1)
        proc = _seed(db, "Proceso", 2, parent_id=macro)
        sub = _seed(db, "Procedimiento", 3, parent_id=proc)
        act = _seed(db, "Actividad", 4, parent_id=sub)
        svc = ProcessCaseService(db)

        # Mover el proceso de N2 → N3 debe empujar su subárbol (+1).
        res = svc.reclassify_case(UUID(proc), level=3, cascade=True)
        assert res["updated"].level == 3
        assert res["descendants_shifted"] == 2

        assert db.get(ProcessCaseModel, sub).level == 4
        assert db.get(ProcessCaseModel, act).level == 5
    finally:
        db.close()


def test_reclasificar_no_permite_nivel_igual_o_superior_al_padre() -> None:
    reset_db()
    db = SessionLocal()
    try:
        macro = _seed(db, "Macro", 1)
        child = _seed(db, "Recepcion", 2, parent_id=macro)
        svc = ProcessCaseService(db)

        with pytest.raises(ValueError):
            svc.reclassify_case(UUID(child), level=1)  # = nivel del padre
    finally:
        db.close()
