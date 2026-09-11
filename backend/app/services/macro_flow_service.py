"""
Macro-Flow Service — gestiona las cadenas/flujos entre procesos N2 dentro de un macro N1.

Una "cadena" es una lista ordenada de IDs de procesos N2 que se ejecutan en secuencia.
Cadenas de longitud 1 representan procesos independientes.

Genera BPMN 2.0 dinámicamente desde la definición de cadenas, listo para bpmn-js.
"""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.process_case import ProcessCaseModel


def get_flow_definition(db: Session, macro_id: str) -> list[list[str]]:
    """Lee y deserializa el flow_definition del macro. Devuelve [] si no hay."""
    case = db.get(ProcessCaseModel, macro_id)
    if case is None or not case.flow_definition:
        return []
    try:
        data = json.loads(case.flow_definition)
        if isinstance(data, list):
            return [chain for chain in data if isinstance(chain, list)]
    except Exception:
        pass
    return []


def set_flow_definition(db: Session, macro_id: str, chains: list[list[str]]) -> bool:
    """Guarda las cadenas en JSON. Devuelve True si se actualizó."""
    case = db.get(ProcessCaseModel, macro_id)
    if case is None:
        return False
    # Validar: cada cadena es lista de strings (IDs de hijos)
    cleaned = [
        [str(x) for x in c if isinstance(x, str) and x]
        for c in chains
        if isinstance(c, list)
    ]
    cleaned = [c for c in cleaned if c]
    case.flow_definition = json.dumps(cleaned)
    db.commit()
    return True


def list_children_with_orphans(db: Session, macro_id: str, chains: list[list[str]]) -> dict[str, Any]:
    """Devuelve los hijos N2 del macro y marca los huérfanos (no incluidos en ninguna cadena)."""
    stmt = select(ProcessCaseModel).where(ProcessCaseModel.parent_id == macro_id)
    children = db.scalars(stmt).all()
    used_ids = {cid for chain in chains for cid in chain}
    orphans = [c for c in children if c.id not in used_ids]
    return {
        "children": [
            {"id": c.id, "name": c.name, "level": c.level, "area": c.area, "process_type": c.process_type}
            for c in children
        ],
        "orphans": [
            {"id": c.id, "name": c.name, "level": c.level, "area": c.area, "process_type": c.process_type}
            for c in orphans
        ],
    }


def generate_bpmn_from_flow(
    db: Session,
    macro_id: str,
    *,
    process_name: str = "Macro Flow",
) -> str | None:
    """Genera BPMN 2.0 XML desde las cadenas definidas en el macro N1."""
    chains = get_flow_definition(db, macro_id)
    if not chains:
        return None

    # Recolectar info de cada hijo referenciado
    all_ids = {cid for chain in chains for cid in chain}
    cases: dict[str, ProcessCaseModel] = {}
    for cid in all_ids:
        c = db.get(ProcessCaseModel, cid)
        if c is not None:
            cases[cid] = c

    process_id = f"Process_macro_{macro_id[:8]}"
    flow_elements: list[str] = []
    shapes: list[str] = []
    edges: list[str] = []

    # Layout simple: cada cadena en una "lane" horizontal
    LANE_HEIGHT = 140
    NODE_WIDTH = 120
    NODE_HEIGHT = 60
    H_SPACING = 60
    X_OFFSET = 60
    Y_OFFSET = 60

    flow_seq = 0
    def next_flow_id() -> str:
        nonlocal flow_seq
        flow_seq += 1
        return f"Flow_{flow_seq}"

    for chain_idx, chain in enumerate(chains):
        if not chain:
            continue
        y = Y_OFFSET + chain_idx * LANE_HEIGHT

        # Start event
        start_id = f"Start_{chain_idx}"
        flow_elements.append(f'<bpmn:startEvent id="{start_id}" name="Inicio"/>')
        shapes.append(
            f'<bpmndi:BPMNShape id="{start_id}_di" bpmnElement="{start_id}">'
            f'<dc:Bounds x="{X_OFFSET}" y="{y + NODE_HEIGHT/2 - 18}" width="36" height="36"/>'
            f'</bpmndi:BPMNShape>'
        )

        # Tasks (one per process in chain)
        prev_id = start_id
        prev_x = X_OFFSET + 36
        for i, cid in enumerate(chain):
            case = cases.get(cid)
            label = (case.name if case else "Proceso desconocido").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            task_id = f"Task_{chain_idx}_{i}"
            x = prev_x + H_SPACING
            # Cada N2 se representa como un subproceso COLAPSADO (rectángulo con "+"),
            # porque al descender se modela su propio BPMN. isExpanded="false" en el
            # shape hace que bpmn-js dibuje el marcador "+".
            flow_elements.append(f'<bpmn:subProcess id="{task_id}" name="{label}"/>')
            shapes.append(
                f'<bpmndi:BPMNShape id="{task_id}_di" bpmnElement="{task_id}" isExpanded="false">'
                f'<dc:Bounds x="{x}" y="{y}" width="{NODE_WIDTH}" height="{NODE_HEIGHT}"/>'
                f'</bpmndi:BPMNShape>'
            )

            # Flow from prev to this task
            fid = next_flow_id()
            flow_elements.append(f'<bpmn:sequenceFlow id="{fid}" sourceRef="{prev_id}" targetRef="{task_id}"/>')
            edges.append(
                f'<bpmndi:BPMNEdge id="{fid}_di" bpmnElement="{fid}">'
                f'<di:waypoint x="{prev_x}" y="{y + NODE_HEIGHT/2}"/>'
                f'<di:waypoint x="{x}" y="{y + NODE_HEIGHT/2}"/>'
                f'</bpmndi:BPMNEdge>'
            )
            prev_id = task_id
            prev_x = x + NODE_WIDTH

        # End event
        end_id = f"End_{chain_idx}"
        end_x = prev_x + H_SPACING
        flow_elements.append(f'<bpmn:endEvent id="{end_id}" name="Fin"/>')
        shapes.append(
            f'<bpmndi:BPMNShape id="{end_id}_di" bpmnElement="{end_id}">'
            f'<dc:Bounds x="{end_x}" y="{y + NODE_HEIGHT/2 - 18}" width="36" height="36"/>'
            f'</bpmndi:BPMNShape>'
        )
        fid = next_flow_id()
        flow_elements.append(f'<bpmn:sequenceFlow id="{fid}" sourceRef="{prev_id}" targetRef="{end_id}"/>')
        edges.append(
            f'<bpmndi:BPMNEdge id="{fid}_di" bpmnElement="{fid}">'
            f'<di:waypoint x="{prev_x}" y="{y + NODE_HEIGHT/2}"/>'
            f'<di:waypoint x="{end_x}" y="{y + NODE_HEIGHT/2}"/>'
            f'</bpmndi:BPMNEdge>'
        )

    name_escaped = process_name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    flow_xml = "\n        ".join(flow_elements)
    shape_xml = "\n      ".join(shapes)
    edge_xml = "\n      ".join(edges)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  id="Definitions_{macro_id[:8]}" targetNamespace="http://bpms.local">
  <bpmn:process id="{process_id}" name="{name_escaped}" isExecutable="false">
        {flow_xml}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="{process_id}">
      {shape_xml}
      {edge_xml}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>"""


def suggest_chains_from_children(db: Session, macro_id: str) -> list[list[str]]:
    """Heurística simple: cada hijo N2 como cadena independiente (default seguro)."""
    stmt = select(ProcessCaseModel).where(ProcessCaseModel.parent_id == macro_id)
    children = db.scalars(stmt).all()
    return [[c.id] for c in children]


__all__ = [
    "get_flow_definition",
    "set_flow_definition",
    "generate_bpmn_from_flow",
    "list_children_with_orphans",
    "suggest_chains_from_children",
]
