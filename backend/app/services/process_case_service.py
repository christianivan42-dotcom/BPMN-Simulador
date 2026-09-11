from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cognitive.context_propagator import propagate_down
from app.models.process_case import ProcessCaseModel
from app.models.process_repository import ProcessRepositoryModel
from app.schemas.process_case import (
    AnalysisStatus,
    MapStatus,
    ProcessCaseBulkCreate,
    ProcessCaseCreate,
    ProcessCaseResponse,
    ProcessCaseStatus,
    ProcessCaseTreeNode,
    ProcessType,
    Staleness,
)


class ProcessCaseService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ── Listado / consulta ────────────────────────────────────────────────────

    def list_cases(self) -> list[ProcessCaseResponse]:
        statement = select(ProcessCaseModel).order_by(ProcessCaseModel.created_at.desc())
        cases = self.db.scalars(statement).all()
        return [self._to_response(process_case) for process_case in cases]

    def get_case(self, case_id: UUID) -> ProcessCaseResponse | None:
        process_case = self.db.get(ProcessCaseModel, str(case_id))
        if process_case is None:
            return None
        return self._to_response(process_case)

    def list_children(self, parent_id: UUID) -> list[ProcessCaseResponse]:
        stmt = select(ProcessCaseModel).where(ProcessCaseModel.parent_id == str(parent_id))
        return [self._to_response(c) for c in self.db.scalars(stmt).all()]

    def get_tree(self) -> list[ProcessCaseTreeNode]:
        """Devuelve todo el árbol jerárquico de procesos (raíces + hijos recursivos)."""
        all_cases = self.db.scalars(select(ProcessCaseModel)).all()
        index: dict[str, ProcessCaseTreeNode] = {}
        for case in all_cases:
            index[case.id] = self._to_tree_node(case)

        roots: list[ProcessCaseTreeNode] = []
        for case in all_cases:
            node = index[case.id]
            if case.parent_id and case.parent_id in index:
                index[case.parent_id].children.append(node)
            else:
                roots.append(node)

        # Ordenar cada nivel por nombre
        def _sort(nodes: list[ProcessCaseTreeNode]) -> None:
            nodes.sort(key=lambda n: (n.level or 0, n.name.lower()))
            for n in nodes:
                _sort(n.children)
        _sort(roots)
        return roots

    # ── Creación ──────────────────────────────────────────────────────────────

    def create_case(self, payload: ProcessCaseCreate) -> ProcessCaseResponse:
        process_case = self._build_case(payload)
        self.db.add(process_case)
        self.db.commit()
        self.db.refresh(process_case)

        # Si tiene padre, marcar staleness en cascada ascendente y propagar contexto
        if process_case.parent_id:
            self._cascade_staleness(
                process_case.parent_id,
                reason=f"Se agregó hijo: {process_case.name}",
            )
            propagate_down(process_case.parent_id, process_case.id, self.db)

        return self._to_response(process_case)

    def bulk_create(self, payload: ProcessCaseBulkCreate) -> list[ProcessCaseResponse]:
        """Crea múltiples cases en una sola transacción — para auto-poblar N2 desde N1."""
        created: list[ProcessCaseModel] = []
        parents_to_invalidate: set[str] = set()

        for item in payload.items:
            case = self._build_case(item)
            self.db.add(case)
            created.append(case)
            if case.parent_id:
                parents_to_invalidate.add(case.parent_id)

        self.db.commit()
        for c in created:
            self.db.refresh(c)

        for parent_id in parents_to_invalidate:
            self._cascade_staleness(parent_id, reason="Hijos agregados en lote")

        for c in created:
            if c.parent_id:
                propagate_down(c.parent_id, c.id, self.db)

        return [self._to_response(c) for c in created]

    # ── Actualización con cascada de invalidación ─────────────────────────────

    def update_case(
        self,
        case_id: UUID,
        *,
        name: str | None = None,
        objective: str | None = None,
        scope: str | None = None,
        analysis_status: AnalysisStatus | None = None,
        invalidate: bool = True,
    ) -> ProcessCaseResponse | None:
        case = self.db.get(ProcessCaseModel, str(case_id))
        if case is None:
            return None

        changed = False
        if name is not None and name != case.name:
            case.name = name
            changed = True
        if objective is not None and objective != case.objective:
            case.objective = objective
            changed = True
        if scope is not None and scope != case.scope:
            case.scope = scope
            changed = True
        if analysis_status is not None and analysis_status.value != case.analysis_status:
            case.analysis_status = analysis_status.value
            if analysis_status == AnalysisStatus.analizado_completo:
                case.last_analyzed_at = datetime.now(UTC)
                case.staleness = Staleness.ok.value
                case.staleness_reason = None
                case.staleness_since = None
            changed = True

        if changed:
            case.updated_at = datetime.now(UTC)
            # Marcar propio modificado (solo si no es solo un cambio de estado de análisis)
            if invalidate and (name is not None or objective is not None or scope is not None):
                case.staleness = Staleness.propio_modificado.value
                case.staleness_since = datetime.now(UTC)
            self.db.commit()
            self.db.refresh(case)

            if invalidate and case.parent_id:
                self._cascade_staleness(
                    case.parent_id,
                    reason=f"Hijo modificado: {case.name}",
                )

        return self._to_response(case)

    def reclassify_case(
        self,
        case_id: UUID,
        *,
        level: int,
        cascade: bool = True,
    ) -> dict | None:
        """
        Reclasifica manualmente el NIVEL de un nodo (override del analista sobre la
        clasificación automática). Mantiene la integridad de la cadena N0→NN:

          · El nuevo nivel debe ser más profundo que el del padre (no se permite
            que un hijo quede al nivel del padre o por encima).
          · El `process_type` se deriva del nivel (conservando el tipo actual si ya
            pertenece a ese nivel).
          · Si `cascade`, todo el subárbol se desplaza el mismo delta para preservar
            la jerarquía relativa, y se marca obsolescencia para re-análisis.

        Devuelve {"updated": ProcessCaseResponse, "descendants_shifted": int} o None
        si el caso no existe. Lanza ValueError si el nivel es inválido.
        """
        from app.services.bpmn_level_classifier import type_for_level

        case = self.db.get(ProcessCaseModel, str(case_id))
        if case is None:
            return None

        if level < 1 or level > 6:
            raise ValueError("El nivel debe estar entre 1 y 6.")

        parent_level = 0
        if case.parent_id:
            parent = self.db.get(ProcessCaseModel, case.parent_id)
            parent_level = (parent.level if parent else 0) or 0
        if level <= parent_level:
            raise ValueError(
                f"Un nodo hijo debe ser más profundo que su padre (N{parent_level}); "
                f"el mínimo permitido es N{parent_level + 1}."
            )

        old_level = case.level or 2
        delta = level - old_level

        case.level = level
        case.process_type = type_for_level(level, case.process_type)
        case.updated_at = datetime.now(UTC)
        case.staleness = Staleness.propio_modificado.value
        case.staleness_reason = f"Reclasificado a N{level}"
        case.staleness_since = datetime.now(UTC)

        shifted = 0
        if cascade and delta != 0:
            # BFS por descendientes, desplazando cada uno el mismo delta (acotado a N6).
            frontier = [case.id]
            visited: set[str] = {case.id}
            while frontier:
                current_id = frontier.pop()
                stmt = select(ProcessCaseModel).where(ProcessCaseModel.parent_id == current_id)
                for child in self.db.scalars(stmt).all():
                    if child.id in visited:
                        continue
                    visited.add(child.id)
                    new_child_level = min(max((child.level or 2) + delta, 2), 6)
                    if new_child_level != child.level:
                        child.level = new_child_level
                        child.process_type = type_for_level(new_child_level, child.process_type)
                        child.staleness = Staleness.propio_modificado.value
                        child.staleness_reason = f"Reclasificación en cascada (padre movido a N{level})"
                        child.staleness_since = datetime.now(UTC)
                        shifted += 1
                    frontier.append(child.id)

        self.db.commit()
        self.db.refresh(case)

        if case.parent_id:
            self._cascade_staleness(case.parent_id, reason=f"Hijo reclasificado: {case.name}")

        return {"updated": self._to_response(case), "descendants_shifted": shifted}

    def delete_case(self, case_id: UUID) -> bool:
        case = self.db.get(ProcessCaseModel, str(case_id))
        if case is None:
            return False
        parent_id = case.parent_id
        parent_name = case.name
        self.db.delete(case)
        self.db.commit()
        if parent_id:
            self._cascade_staleness(parent_id, reason=f"Hijo eliminado: {parent_name}")
        return True

    # ── Cascada de invalidación ───────────────────────────────────────────────

    def _cascade_staleness(self, start_id: str, reason: str) -> None:
        """Marca como stale al padre y todos sus ancestros."""
        now = datetime.now(UTC)
        current_id: str | None = start_id
        visited: set[str] = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            node = self.db.get(ProcessCaseModel, current_id)
            if node is None:
                break
            # Solo escalar si el padre ya estaba analizado (si no, no tiene sentido)
            if node.analysis_status in (
                AnalysisStatus.analizado_completo.value,
                AnalysisStatus.agregado.value,
                AnalysisStatus.en_analisis.value,
            ):
                node.staleness = Staleness.hijos_modificados.value
                node.staleness_reason = reason
                node.staleness_since = now
            current_id = node.parent_id
        self.db.commit()

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _build_case(self, payload: ProcessCaseCreate) -> ProcessCaseModel:
        case = ProcessCaseModel(
            id=str(uuid4()),
            name=payload.name,
            area=payload.area,
            objective=payload.objective,
            scope=payload.scope,
            owner=payload.owner,
            status=ProcessCaseStatus.draft.value,
            process_type=payload.process_type.value if payload.process_type else None,
            level=payload.level if payload.level is not None else 1,
            parent_id=payload.parent_id,
            map_status="identificado",
            analysis_status=AnalysisStatus.pendiente.value,
            staleness=Staleness.ok.value,
            transversal=payload.transversal,
            related_macro_ids=",".join(payload.related_macro_ids) if payload.related_macro_ids else None,
        )
        repository = ProcessRepositoryModel(
            id=str(uuid4()),
            case_id=case.id,
            name=f"Repositorio - {payload.name}",
        )
        case.repository = repository
        return case

    @staticmethod
    def _to_response(case: ProcessCaseModel) -> ProcessCaseResponse:
        return ProcessCaseResponse(
            id=UUID(case.id),
            name=case.name,
            area=case.area,
            objective=case.objective,
            scope=case.scope,
            owner=case.owner,
            status=ProcessCaseStatus(case.status),
            process_type=ProcessType(case.process_type) if case.process_type else None,
            level=case.level,
            parent_id=case.parent_id,
            map_status=MapStatus(case.map_status or "identificado"),
            analysis_status=AnalysisStatus(case.analysis_status or "pendiente"),
            staleness=Staleness(case.staleness or "ok"),
            staleness_reason=case.staleness_reason,
            staleness_since=case.staleness_since,
            last_analyzed_at=case.last_analyzed_at,
            transversal=bool(case.transversal),
            related_macro_ids=case.related_macro_ids.split(",") if case.related_macro_ids else [],
            created_at=case.created_at,
            updated_at=case.updated_at,
        )

    @staticmethod
    def _to_tree_node(case: ProcessCaseModel) -> ProcessCaseTreeNode:
        return ProcessCaseTreeNode(
            id=UUID(case.id),
            name=case.name,
            area=case.area,
            level=case.level,
            parent_id=case.parent_id,
            process_type=ProcessType(case.process_type) if case.process_type else None,
            analysis_status=AnalysisStatus(case.analysis_status or "pendiente"),
            staleness=Staleness(case.staleness or "ok"),
            transversal=bool(case.transversal),
            children=[],
        )
