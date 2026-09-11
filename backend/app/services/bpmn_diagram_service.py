"""Servicio de diagramas BPMN — CRUD sobre `bpmn_diagrams`."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.bpmn_diagram import BpmnDiagramModel
from app.schemas.bpmn_diagram import (
    BpmnDiagramCreate,
    BpmnDiagramRead,
    BpmnDiagramSummary,
    BpmnDiagramUpdate,
)


class BpmnDiagramService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ── Lectura ───────────────────────────────────────────────────────────────

    def listar(self, company_id: str) -> list[BpmnDiagramSummary]:
        return [self._to_summary(r) for r in self._rows(company_id)]

    def obtener(self, diagram_id: str) -> BpmnDiagramRead | None:
        row = self.db.get(BpmnDiagramModel, diagram_id)
        return self._to_read(row) if row else None

    # ── Escritura ─────────────────────────────────────────────────────────────

    def crear(self, payload: BpmnDiagramCreate) -> BpmnDiagramRead:
        position = payload.position
        if position is None:
            position = self._next_position(payload.company_id)
        row = BpmnDiagramModel(
            id=str(uuid4()),
            company_id=payload.company_id,
            name=payload.name,
            map_item_id=payload.map_item_id,
            asis_xml=payload.asis_xml,
            tobe_xml=payload.tobe_xml,
            sim_config=payload.sim_config,
            position=position,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return self._to_read(row)

    def actualizar(self, diagram_id: str, payload: BpmnDiagramUpdate) -> BpmnDiagramRead | None:
        row = self.db.get(BpmnDiagramModel, diagram_id)
        if row is None:
            return None
        # exclude_unset: un PATCH que solo trae `asis_xml` no debe borrar el TO-BE.
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(row, field, value)
        self.db.commit()
        self.db.refresh(row)
        return self._to_read(row)

    def eliminar(self, diagram_id: str) -> bool:
        row = self.db.get(BpmnDiagramModel, diagram_id)
        if row is None:
            return False
        self.db.delete(row)
        self.db.commit()
        return True

    def importar(
        self, company_id: str, diagrams: list[BpmnDiagramCreate]
    ) -> list[BpmnDiagramRead]:
        """Importa en bloque los diagramas que estaban en el navegador.

        Es idempotente a propósito: si la empresa ya tiene diagramas guardados no
        importa nada y devuelve lo que hay. Así, si el usuario abre dos pestañas
        a la vez, la migración no duplica su trabajo.
        """
        existing = self.db.scalar(
            select(func.count())
            .select_from(BpmnDiagramModel)
            .where(BpmnDiagramModel.company_id == company_id)
        )
        if existing:
            return [self._to_read(r) for r in self._rows(company_id)]

        for index, item in enumerate(diagrams):
            self.db.add(
                BpmnDiagramModel(
                    id=str(uuid4()),
                    company_id=company_id,
                    name=item.name,
                    map_item_id=item.map_item_id,
                    asis_xml=item.asis_xml,
                    tobe_xml=item.tobe_xml,
                    sim_config=item.sim_config,
                    position=index if item.position is None else item.position,
                )
            )
        self.db.commit()
        return [self._to_read(r) for r in self._rows(company_id)]

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _rows(self, company_id: str) -> list[BpmnDiagramModel]:
        return list(
            self.db.scalars(
                select(BpmnDiagramModel)
                .where(BpmnDiagramModel.company_id == company_id)
                .order_by(BpmnDiagramModel.position, BpmnDiagramModel.created_at)
            ).all()
        )

    def _next_position(self, company_id: str) -> int:
        highest = self.db.scalar(
            select(func.max(BpmnDiagramModel.position)).where(
                BpmnDiagramModel.company_id == company_id
            )
        )
        return 0 if highest is None else highest + 1

    @staticmethod
    def _to_summary(row: BpmnDiagramModel) -> BpmnDiagramSummary:
        return BpmnDiagramSummary(
            id=row.id,
            company_id=row.company_id,
            name=row.name,
            map_item_id=row.map_item_id,
            position=row.position,
            has_asis=bool(row.asis_xml),
            has_tobe=bool(row.tobe_xml),
            updated_at=row.updated_at,
        )

    @staticmethod
    def _to_read(row: BpmnDiagramModel) -> BpmnDiagramRead:
        return BpmnDiagramRead(
            id=row.id,
            company_id=row.company_id,
            name=row.name,
            map_item_id=row.map_item_id,
            position=row.position,
            has_asis=bool(row.asis_xml),
            has_tobe=bool(row.tobe_xml),
            updated_at=row.updated_at,
            asis_xml=row.asis_xml,
            tobe_xml=row.tobe_xml,
            sim_config=row.sim_config,
        )
