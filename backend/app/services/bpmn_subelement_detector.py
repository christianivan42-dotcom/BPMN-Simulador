"""
BPMN Sub-Element Detector — analiza un BPMN XML y crea ProcessCases hijos para
cada sub-elemento dibujado, CLASIFICANDO cada uno por contexto (nombre + tipo BPMN)
para decidir en qué nivel del árbol BPM vive.

Clasificación por contexto (delegada en `bpmn_level_classifier`):
  Cuando se diagrama desde el mapa de procesos (N1) y aparece un "subproceso"
  (la caja con el "+", un <bpmn:subProcess> colapsado) o cualquier actividad nombrada,
  el clasificador identifica de qué nivel se trata:
      · Proceso               → N2
      · Procedimiento         → N3
      · Actividad/Instructivo → N4
  El nivel lo determina el TIPO clasificado, no ciegamente `parent_level + 1`.

Alcance de la detección:
  - Macro N1 (parent.level == 1): cada actividad NOMBRADA del diagrama se vuelve un
    hijo, clasificado a su nivel real (N2/N3/N4). Dibujar la caja en el BPMN crea el
    nodo navegable. (El BPMN es la fuente de verdad — Regla 1.)
  - Niveles N2+ : se descomponen solo los sub-elementos estructurales
    (subProcess, callActivity, businessRuleTask y userTask/manualTask de instructivo),
    para no explotar el árbol con una caja por cada tarea atómica.

Idempotente por partida doble:
  - por ID BPMN: si ya existe un ProcessCase con scope="bpmn:<id>", no lo duplica.
  - por nombre: si ya existe un hijo con el mismo nombre (normalizado), no lo duplica.
    Esto evita re-crear los N2 que ya existen (creados por la paleta/descomposición),
    cuyos nombres reaparecen como tareas en el BPMN generado desde las cadenas.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.process_case import ProcessCaseModel
from app.models.process_repository import ProcessRepositoryModel
from app.schemas.process_case import (
    AnalysisStatus,
    MapStatus,
    ProcessCaseStatus,
)
from app.services.bpmn_level_classifier import (
    INSTRUCT_RE,
    LEVEL_NAMES,
    classify_bpmn_node,
)


# Tags de actividad que, en un macro N1, se clasifican como nodos hijos.
# Cualquier caja nombrada del diagrama del macro es un nodo hijo (su nivel lo
# decide el clasificador por contexto).
MACRO_ACTIVITY_TAGS: list[str] = [
    "task", "userTask", "serviceTask", "sendTask", "receiveTask",
    "manualTask", "scriptTask", "businessRuleTask", "callActivity", "subProcess",
]

# En niveles N2+ solo se descomponen estos sub-elementos estructurales.
SUBELEMENT_TAGS: list[str] = [
    "subProcess", "callActivity", "businessRuleTask", "userTask", "manualTask",
]


def _normalize_name(name: str) -> str:
    """Normaliza un nombre para comparar (sin acentos, minúsculas, espacios colapsados)."""
    nfkd = unicodedata.normalize("NFKD", name)
    no_accents = "".join(c for c in nfkd if not unicodedata.combining(c))
    return " ".join(no_accents.lower().split())


def _find_bpmn_elements(xml: str, tag: str) -> list[dict[str, Any]]:
    """Encuentra todos los elementos <bpmn:tag> o <bpmn2:tag> y devuelve {id, name, has_name}."""
    pattern = re.compile(
        rf'<bpmn2?:{tag}\b([^>]*?)(?:/>|>)',
        re.IGNORECASE,
    )
    out: list[dict[str, Any]] = []
    for m in pattern.finditer(xml):
        attrs = m.group(1)
        id_match = re.search(r'\bid="([^"]+)"', attrs)
        name_match = re.search(r'\bname="([^"]*)"', attrs)
        if id_match:
            real_name = (name_match.group(1).strip() if name_match else "")
            out.append({
                "id": id_match.group(1),
                "name": (real_name or id_match.group(1)),
                "has_name": bool(real_name),
                "tag": tag,
            })
    return out


def detect_and_create_children(
    db: Session,
    parent_case_id: str,
    bpmn_xml: str,
) -> dict[str, Any]:
    """
    Analiza el BPMN y crea ProcessCases hijos para cada sub-elemento detectado.

    Devuelve un dict con:
      - created: lista de hijos creados [{id, name, process_type, bpmn_element_id}]
      - skipped_existing: cuántos sub-elementos ya tenían un hijo creado previamente
      - detected_total: total de sub-elementos detectados
    """
    parent = db.get(ProcessCaseModel, parent_case_id)
    if parent is None:
        return {"error": "parent not found", "created": [], "skipped_existing": 0, "detected_total": 0}

    parent_level = parent.level or 2
    is_macro = parent_level == 1
    parent_level_name = LEVEL_NAMES.get(parent_level, "nodo padre")

    # Hijos existentes — idempotencia por ID BPMN (scope "bpmn:<id>") y por nombre.
    stmt = select(ProcessCaseModel).where(ProcessCaseModel.parent_id == parent_case_id)
    existing = db.scalars(stmt).all()
    existing_bpmn_ids: set[str] = set()
    existing_names: set[str] = set()
    for c in existing:
        if c.scope and c.scope.startswith("bpmn:"):
            existing_bpmn_ids.add(c.scope[5:])
        if c.name:
            existing_names.add(_normalize_name(c.name))

    # Tags a escanear: en el mapa N1 son todas las actividades; en N2+ solo los
    # sub-elementos estructurales.
    tags = MACRO_ACTIVITY_TAGS if is_macro else SUBELEMENT_TAGS

    # Detectar + CLASIFICAR cada elemento por contexto (nombre + tipo BPMN).
    detected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for tag in tags:
        for el in _find_bpmn_elements(bpmn_xml, tag):
            if el["id"] in seen_ids:
                continue
            # En el macro solo aceptamos cajas con nombre real (evita nodos basura).
            if is_macro and not el.get("has_name"):
                continue
            # En N2+ las tareas de usuario solo se descomponen si son instructivos,
            # para no crear un nodo por cada tarea atómica del diagrama.
            if not is_macro and tag in ("userTask", "manualTask") and not INSTRUCT_RE.search(el["name"]):
                continue
            cls = classify_bpmn_node(tag=tag, name=el["name"], parent_level=parent_level)
            seen_ids.add(el["id"])
            detected.append({**el, **cls})

    created: list[dict[str, Any]] = []
    skipped = 0
    created_names: set[str] = set()

    for d in detected:
        norm = _normalize_name(d["name"])
        # Ya existe por ID BPMN, por nombre previo, o por nombre creado en esta misma pasada.
        if d["id"] in existing_bpmn_ids or norm in existing_names or norm in created_names:
            skipped += 1
            continue
        created_names.add(norm)
        # Crear hijo en el nivel que indicó la clasificación.
        new_case = ProcessCaseModel(
            id=str(uuid4()),
            name=d["name"][:160] or f"{d['process_type']} {d['id']}",
            objective=(
                f"{d['level_name']} (N{d['level']}) detectado en el BPMN del "
                f"{parent_level_name} «{parent.name}». {d['rationale']}"
            ),
            scope=f"bpmn:{d['id']}",   # ← marker de idempotencia
            status=ProcessCaseStatus.draft.value,
            process_type=d["process_type"],
            area=parent.area,          # hereda el área del padre para mostrarse coherente
            level=d["level"],
            parent_id=parent_case_id,
            map_status=MapStatus.identificado.value,
            analysis_status=AnalysisStatus.pendiente.value,
        )
        repo = ProcessRepositoryModel(
            id=str(uuid4()),
            case_id=new_case.id,
            name=f"Repositorio - {new_case.name}",
        )
        new_case.repository = repo
        db.add(new_case)
        created.append({
            "id": new_case.id,
            "name": new_case.name,
            "process_type": new_case.process_type,
            "bpmn_element_id": d["id"],
            "level": new_case.level,
            "level_name": d["level_name"],
            "confidence": d["confidence"],
            "rationale": d["rationale"],
        })

    if created:
        db.commit()

    # Resumen de la clasificación de los hijos creados, por nivel.
    by_level = Counter(c["level"] for c in created)
    classification_summary = [
        {"level": lvl, "level_name": LEVEL_NAMES.get(lvl, f"N{lvl}"), "count": cnt}
        for lvl, cnt in sorted(by_level.items())
    ]

    return {
        "created": created,
        "skipped_existing": skipped,
        "detected_total": len(detected),
        "classification": classification_summary,
    }


__all__ = ["detect_and_create_children"]
