from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.process_case import (
    AnalysisStatus,
    ProcessCaseBulkCreate,
    ProcessCaseCreate,
    ProcessCaseResponse,
    ProcessCaseTreeNode,
)
from app.services.process_case_service import ProcessCaseService

router = APIRouter()


@router.get("", response_model=list[ProcessCaseResponse])
def list_process_cases(db: Session = Depends(get_db)) -> list[ProcessCaseResponse]:
    return ProcessCaseService(db).list_cases()


@router.get("/tree", response_model=list[ProcessCaseTreeNode])
def get_process_case_tree(db: Session = Depends(get_db)) -> list[ProcessCaseTreeNode]:
    """Devuelve el árbol jerárquico completo de procesos."""
    return ProcessCaseService(db).get_tree()


@router.post("", response_model=ProcessCaseResponse, status_code=status.HTTP_201_CREATED)
def create_process_case(
    payload: ProcessCaseCreate,
    db: Session = Depends(get_db),
) -> ProcessCaseResponse:
    return ProcessCaseService(db).create_case(payload)


@router.post("/bulk", response_model=list[ProcessCaseResponse], status_code=status.HTTP_201_CREATED)
def bulk_create_process_cases(
    payload: ProcessCaseBulkCreate,
    db: Session = Depends(get_db),
) -> list[ProcessCaseResponse]:
    """Crea múltiples nodos en una transacción — usado para auto-poblar N2 desde macro-procesos."""
    return ProcessCaseService(db).bulk_create(payload)


@router.get("/{case_id}", response_model=ProcessCaseResponse)
def get_process_case(case_id: UUID, db: Session = Depends(get_db)) -> ProcessCaseResponse:
    process_case = ProcessCaseService(db).get_case(case_id)
    if process_case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")
    return process_case


@router.get("/{case_id}/children", response_model=list[ProcessCaseResponse])
def list_process_case_children(case_id: UUID, db: Session = Depends(get_db)) -> list[ProcessCaseResponse]:
    return ProcessCaseService(db).list_children(case_id)


class ProcessCaseUpdate(BaseModel):
    name: str | None = None
    objective: str | None = None
    scope: str | None = None
    analysis_status: AnalysisStatus | None = None
    invalidate: bool = True


@router.patch("/{case_id}", response_model=ProcessCaseResponse)
def update_process_case(
    case_id: UUID,
    payload: ProcessCaseUpdate,
    db: Session = Depends(get_db),
) -> ProcessCaseResponse:
    updated = ProcessCaseService(db).update_case(
        case_id,
        name=payload.name,
        objective=payload.objective,
        scope=payload.scope,
        analysis_status=payload.analysis_status,
        invalidate=payload.invalidate,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")
    return updated


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_process_case(case_id: UUID, db: Session = Depends(get_db)) -> None:
    ok = ProcessCaseService(db).delete_case(case_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")


# ─── Reclasificación manual del nivel (override del analista) ──────────────────

class ReclassifyRequest(BaseModel):
    level: int = Field(ge=1, le=6)
    cascade: bool = True


@router.get("/{case_id}/level-options")
def get_level_options(case_id: UUID, db: Session = Depends(get_db)) -> dict:
    """
    Niveles válidos a los que se puede reclasificar este nodo (siempre más profundos
    que su padre). Alimenta el selector de clasificación del frontend.
    """
    from app.models.process_case import ProcessCaseModel
    from app.services.bpmn_level_classifier import child_level_options

    case = db.get(ProcessCaseModel, str(case_id))
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")

    parent_level = 0
    if case.parent_id:
        parent = db.get(ProcessCaseModel, case.parent_id)
        parent_level = (parent.level if parent else 0) or 0

    return {
        "case_id": str(case_id),
        "current_level": case.level,
        "current_type": case.process_type,
        "options": child_level_options(parent_level),
    }


@router.post("/{case_id}/reclassify")
def reclassify_process_case(
    case_id: UUID,
    payload: ReclassifyRequest,
    db: Session = Depends(get_db),
) -> dict:
    """
    Reclasifica el nivel de un nodo (Proceso N2 / Procedimiento N3 / Actividad-
    Instructivo N4 …). El analista corrige la clasificación automática del BPMN.
    Mantiene la cadena N0→NN coherente (ver `ProcessCaseService.reclassify_case`).
    """
    try:
        result = ProcessCaseService(db).reclassify_case(
            case_id, level=payload.level, cascade=payload.cascade,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")
    return {
        "case_id": str(case_id),
        "level": result["updated"].level,
        "process_type": result["updated"].process_type,
        "descendants_shifted": result["descendants_shifted"],
    }


# ─── Macro-Flow: cadenas/flujos entre procesos N2 de un macro N1 ──────────────

class MacroFlowResponse(BaseModel):
    macro_id: str
    chains: list[list[str]]                # IDs de hijos N2 en orden
    children: list[dict]                   # todos los hijos N2 del macro
    orphans: list[dict]                    # hijos no incluidos en ninguna cadena
    bpmn_xml: str | None                   # BPMN generado dinámicamente desde chains


class MacroFlowUpdate(BaseModel):
    chains: list[list[str]]


@router.get("/{case_id}/macro-flow", response_model=MacroFlowResponse)
def get_macro_flow(case_id: UUID, db: Session = Depends(get_db)) -> MacroFlowResponse:
    from app.services import macro_flow_service as mfs
    from app.services.process_repository_service import ProcessRepositoryService

    case = ProcessCaseService(db).get_case(case_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")
    chains = mfs.get_flow_definition(db, str(case_id))
    summary = mfs.list_children_with_orphans(db, str(case_id), chains)

    # Prioridad: si el usuario ha editado y guardado un BPMN manualmente
    # (artefacto `bpmn_xml_as_is`), devolvemos ese contenido — preserva las
    # ediciones del modelador. Si no, generamos el BPMN al vuelo desde las
    # cadenas del macro como antes.
    bpmn_xml: str | None = None
    artifacts = ProcessRepositoryService(db).list_artifacts(case_id) or []
    saved_bpmns = [a for a in artifacts if a.artifact_type == "bpmn_xml_as_is" and a.versions]
    if saved_bpmns:
        # list_artifacts ya devuelve los artefactos ordenados por created_at desc;
        # tomamos el más reciente cuya versión más reciente tenga contenido.
        latest_artifact = saved_bpmns[0]
        latest_version = latest_artifact.versions[0]  # _artifact_to_response sortea desc por created_at
        if latest_version and latest_version.content:
            bpmn_xml = latest_version.content

    if not bpmn_xml:
        bpmn_xml = mfs.generate_bpmn_from_flow(db, str(case_id), process_name=case.name)

    return MacroFlowResponse(
        macro_id=str(case_id),
        chains=chains,
        children=summary["children"],
        orphans=summary["orphans"],
        bpmn_xml=bpmn_xml,
    )


class SaveBpmnRequest(BaseModel):
    bpmn_xml: str
    detect_subelements: bool = True


@router.post("/{case_id}/save-bpmn")
def save_bpmn_endpoint(
    case_id: UUID,
    payload: SaveBpmnRequest,
    db: Session = Depends(get_db),
) -> dict:
    """
    Persiste el BPMN XML editado del caso como artefacto versionado.
    Si `detect_subelements`, identifica subProcess / callActivity / businessRuleTask /
    userTask con "instructivo" en el name y crea ProcessCases hijos automáticamente
    para que cada uno pueda ser analizado por todos los agentes BPMN.
    """
    from app.services.process_repository_service import ProcessRepositoryService
    from app.services.bpmn_subelement_detector import detect_and_create_children

    case = ProcessCaseService(db).get_case(case_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")

    # 0) Asegurar que el caso tenga un ProcessRepository — los nodos sembrados
    # antiguamente pueden no tenerlo y create_artifact retornaría None silenciosamente.
    from app.models.process_case import ProcessCaseModel
    from app.models.process_repository import ProcessRepositoryModel as _RepoModel
    from uuid import uuid4 as _uuid4
    case_model = db.get(ProcessCaseModel, str(case_id))
    if case_model is not None and case_model.repository is None:
        repo = _RepoModel(
            id=str(_uuid4()),
            case_id=case_model.id,
            name=f"Repositorio - {case_model.name}",
        )
        case_model.repository = repo
        db.add(repo)
        db.flush()

    # 1) Persistir el BPMN reutilizando UN solo artefacto por caso (actualiza en
    # sitio). Así el autoguardado del editor no infla la BD con un artefacto por
    # cada cambio, y al recargar siempre se obtiene el último layout guardado.
    artifact_id = ProcessRepositoryService(db).save_or_update_bpmn_as_is(
        case_id, payload.bpmn_xml,
    )

    # 2) Detectar sub-elementos y crear hijos
    detection: dict = {"created": [], "skipped_existing": 0, "detected_total": 0}
    if payload.detect_subelements:
        detection = detect_and_create_children(db, str(case_id), payload.bpmn_xml)

    return {
        "case_id": str(case_id),
        "artifact_id": artifact_id,
        "detection": detection,
    }


@router.post("/{case_id}/aggregate-down")
def aggregate_down_endpoint(case_id: UUID, db: Session = Depends(get_db)) -> dict:
    """Recorre todos los descendientes y consolida análisis al nodo raíz (bottom-up)."""
    from app.services.aggregator_service import aggregate_down
    case = ProcessCaseService(db).get_case(case_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")
    return aggregate_down(db, str(case_id))


@router.post("/{case_id}/aggregate-by-chains")
def aggregate_by_chains_endpoint(case_id: UUID, db: Session = Depends(get_db)) -> dict:
    """Para un macro N1: agrega por cada cadena del flow_definition separadamente."""
    from app.services.aggregator_service import aggregate_by_chains
    case = ProcessCaseService(db).get_case(case_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")
    return aggregate_by_chains(db, str(case_id))


@router.put("/{case_id}/macro-flow", response_model=MacroFlowResponse)
def update_macro_flow(case_id: UUID, payload: MacroFlowUpdate, db: Session = Depends(get_db)) -> MacroFlowResponse:
    from app.services import macro_flow_service as mfs
    case = ProcessCaseService(db).get_case(case_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Process case not found")
    mfs.set_flow_definition(db, str(case_id), payload.chains)
    chains = mfs.get_flow_definition(db, str(case_id))
    summary = mfs.list_children_with_orphans(db, str(case_id), chains)
    bpmn_xml = mfs.generate_bpmn_from_flow(db, str(case_id), process_name=case.name)
    return MacroFlowResponse(
        macro_id=str(case_id),
        chains=chains,
        children=summary["children"],
        orphans=summary["orphans"],
        bpmn_xml=bpmn_xml,
    )
