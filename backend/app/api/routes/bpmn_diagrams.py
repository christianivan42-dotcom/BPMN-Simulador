"""API de diagramas BPMN — persistencia real de lo que se modela en el editor.

Sustituye al almacenamiento exclusivo en localStorage: los diagramas dejan de
depender del navegador y quedan disponibles desde cualquier equipo.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.bpmn_diagram import (
    BpmnDiagramCreate,
    BpmnDiagramImport,
    BpmnDiagramRead,
    BpmnDiagramSummary,
    BpmnDiagramUpdate,
)
from app.services.bpmn_diagram_service import BpmnDiagramService

router = APIRouter()


@router.get(
    "",
    response_model=list[BpmnDiagramSummary],
    summary="Listar los diagramas de una empresa (sin el XML)",
)
def listar_diagramas(
    company_id: str = Query(..., description="Empresa propietaria de los diagramas"),
    db: Session = Depends(get_db),
) -> list[BpmnDiagramSummary]:
    return BpmnDiagramService(db).listar(company_id)


@router.post(
    "",
    response_model=BpmnDiagramRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear un diagrama",
)
def crear_diagrama(payload: BpmnDiagramCreate, db: Session = Depends(get_db)) -> BpmnDiagramRead:
    return BpmnDiagramService(db).crear(payload)


@router.post(
    "/import",
    response_model=list[BpmnDiagramRead],
    summary="Importar diagramas guardados en el navegador (migración)",
)
def importar_diagramas(
    payload: BpmnDiagramImport, db: Session = Depends(get_db)
) -> list[BpmnDiagramRead]:
    return BpmnDiagramService(db).importar(payload.company_id, payload.diagrams)


@router.get(
    "/{diagram_id}",
    response_model=BpmnDiagramRead,
    summary="Obtener un diagrama con su XML",
)
def obtener_diagrama(diagram_id: str, db: Session = Depends(get_db)) -> BpmnDiagramRead:
    result = BpmnDiagramService(db).obtener(diagram_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Diagrama no encontrado")
    return result


@router.patch(
    "/{diagram_id}",
    response_model=BpmnDiagramRead,
    summary="Actualizar un diagrama (parcial)",
)
def actualizar_diagrama(
    diagram_id: str, payload: BpmnDiagramUpdate, db: Session = Depends(get_db)
) -> BpmnDiagramRead:
    result = BpmnDiagramService(db).actualizar(diagram_id, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="Diagrama no encontrado")
    return result


@router.delete(
    "/{diagram_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar un diagrama",
)
def eliminar_diagrama(diagram_id: str, db: Session = Depends(get_db)) -> None:
    if not BpmnDiagramService(db).eliminar(diagram_id):
        raise HTTPException(status_code=404, detail="Diagrama no encontrado")
