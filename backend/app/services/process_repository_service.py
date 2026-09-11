from difflib import unified_diff
from hashlib import sha256
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.process_repository import (
    ArtifactCommentModel,
    ArtifactDecisionModel,
    ArtifactEvidenceModel,
    ArtifactVersionModel,
    ProcessArtifactModel,
    ProcessRepositoryModel,
)
from app.schemas.process_repository import (
    ArtifactCommentCreate,
    ArtifactCommentResponse,
    ArtifactDecisionAction,
    ArtifactDecisionCreate,
    ArtifactDecisionResponse,
    ArtifactEvidenceCreate,
    ArtifactEvidenceResponse,
    ArtifactQualityResponse,
    ArtifactType,
    ArtifactVersionCreate,
    ArtifactVersionHistoryResponse,
    ArtifactVersionResponse,
    ArtifactVersionStatus,
    QualityCheckResponse,
    ProcessArtifactCreate,
    ProcessArtifactResponse,
    ProcessRepositoryResponse,
    VersionDiffResponse,
)

STATUS_BY_ACTION = {
    ArtifactDecisionAction.submit_for_review: ArtifactVersionStatus.in_review,
    ArtifactDecisionAction.request_changes: ArtifactVersionStatus.changes_requested,
    ArtifactDecisionAction.approve: ArtifactVersionStatus.approved,
    ArtifactDecisionAction.publish: ArtifactVersionStatus.published,
    ArtifactDecisionAction.reject: ArtifactVersionStatus.rejected,
    ArtifactDecisionAction.archive: ArtifactVersionStatus.archived,
}

ALLOWED_TRANSITIONS = {
    ArtifactVersionStatus.draft: {
        ArtifactDecisionAction.submit_for_review,
        ArtifactDecisionAction.archive,
    },
    ArtifactVersionStatus.changes_requested: {
        ArtifactDecisionAction.submit_for_review,
        ArtifactDecisionAction.archive,
    },
    ArtifactVersionStatus.in_review: {
        ArtifactDecisionAction.request_changes,
        ArtifactDecisionAction.approve,
        ArtifactDecisionAction.reject,
        ArtifactDecisionAction.archive,
    },
    ArtifactVersionStatus.approved: {
        ArtifactDecisionAction.publish,
        ArtifactDecisionAction.archive,
    },
    ArtifactVersionStatus.published: {
        ArtifactDecisionAction.archive,
    },
    ArtifactVersionStatus.rejected: {
        ArtifactDecisionAction.archive,
    },
    ArtifactVersionStatus.archived: set(),
}


class VersionTransitionError(ValueError):
    pass


class ProcessRepositoryService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_case_id(self, case_id: UUID) -> ProcessRepositoryResponse | None:
        repository = self._get_repository_model(case_id)
        if repository is None:
            return None
        return self._repository_to_response(repository)

    def list_artifacts(self, case_id: UUID) -> list[ProcessArtifactResponse] | None:
        repository = self._get_repository_model(case_id)
        if repository is None:
            return None

        statement = (
            select(ProcessArtifactModel)
            .where(ProcessArtifactModel.repository_id == repository.id)
            .options(selectinload(ProcessArtifactModel.versions))
            .order_by(ProcessArtifactModel.created_at.desc())
        )
        artifacts = self.db.scalars(statement).all()
        return [self._artifact_to_response(artifact) for artifact in artifacts]

    def create_artifact(
        self,
        case_id: UUID,
        payload: ProcessArtifactCreate,
    ) -> ProcessArtifactResponse | None:
        repository = self._get_repository_model(case_id)
        if repository is None:
            return None

        artifact = ProcessArtifactModel(
            id=str(uuid4()),
            repository_id=repository.id,
            artifact_type=payload.artifact_type.value,
            title=payload.title,
            description=payload.description,
        )
        version = ArtifactVersionModel(
            id=str(uuid4()),
            artifact_id=artifact.id,
            version=payload.version,
            status=ArtifactVersionStatus.draft.value,
            content=payload.content,
            change_summary=payload.change_summary,
            author=payload.author,
            content_hash=sha256(payload.content.encode("utf-8")).hexdigest(),
        )
        artifact.current_version_id = version.id
        artifact.versions.append(version)

        self.db.add(artifact)
        self.db.commit()
        self.db.refresh(artifact)
        return self._artifact_to_response(artifact)

    def save_or_update_bpmn_as_is(
        self,
        case_id: UUID,
        content: str,
        *,
        author: str = "Usuario",
        change_summary: str = "Edición desde el modelador BPMN.",
    ) -> str | None:
        """
        Persiste el BPMN AS-IS del caso reutilizando UN solo artefacto.

        Si ya existe un artefacto `bpmn_xml_as_is`, actualiza EN SITIO el contenido
        de su versión más reciente (evita inflar la BD con un artefacto/versión por
        cada autoguardado). Si no existe, lo crea. Devuelve el artifact_id.
        """
        repository = self._get_repository_model(case_id)
        if repository is None:
            return None

        artifact = (
            self.db.execute(
                select(ProcessArtifactModel)
                .where(
                    ProcessArtifactModel.repository_id == repository.id,
                    ProcessArtifactModel.artifact_type == "bpmn_xml_as_is",
                )
                .options(selectinload(ProcessArtifactModel.versions))
                .order_by(ProcessArtifactModel.created_at.desc())
            )
            .scalars()
            .first()
        )

        if artifact is not None and artifact.versions:
            latest = max(artifact.versions, key=lambda v: v.created_at)
            latest.content = content
            latest.content_hash = sha256(content.encode("utf-8")).hexdigest()
            latest.change_summary = change_summary
            latest.author = author
            self.db.commit()
            return artifact.id

        created = self.create_artifact(
            case_id,
            ProcessArtifactCreate(
                artifact_type=ArtifactType.bpmn_xml_as_is,
                title="BPMN editado en el modelador",
                description="BPMN editado manualmente por el usuario en el editor visual.",
                content=content,
                version="auto",
                change_summary=change_summary,
                author=author,
            ),
        )
        return created.id if created else None

    def create_artifact_version(
        self,
        artifact_id: UUID,
        payload: ArtifactVersionCreate,
    ) -> ArtifactVersionResponse | None:
        artifact = self._get_artifact_model(artifact_id)
        if artifact is None:
            return None

        if any(version.version == payload.version for version in artifact.versions):
            raise VersionTransitionError("Version already exists for this artifact")

        version = ArtifactVersionModel(
            id=str(uuid4()),
            artifact_id=artifact.id,
            version=payload.version,
            status=ArtifactVersionStatus.draft.value,
            content=payload.content,
            change_summary=payload.change_summary,
            author=payload.author,
            content_hash=sha256(payload.content.encode("utf-8")).hexdigest(),
        )
        artifact.current_version_id = version.id
        artifact.versions.append(version)
        self.db.commit()
        self.db.refresh(version)
        return self._version_to_response(version)

    def decide_version(
        self,
        version_id: UUID,
        payload: ArtifactDecisionCreate,
    ) -> ArtifactDecisionResponse | None:
        version = self._get_version_model(version_id)
        if version is None:
            return None

        previous_status = ArtifactVersionStatus(version.status)
        allowed_actions = ALLOWED_TRANSITIONS[previous_status]

        if payload.action not in allowed_actions:
            raise VersionTransitionError(
                f"Action {payload.action} is not allowed from status {previous_status}"
            )

        new_status = STATUS_BY_ACTION[payload.action]
        decision = ArtifactDecisionModel(
            id=str(uuid4()),
            version_id=version.id,
            action=payload.action.value,
            previous_status=previous_status.value,
            new_status=new_status.value,
            reviewer=payload.reviewer,
            comment=payload.comment,
        )
        version.status = new_status.value

        self.db.add(decision)
        self.db.commit()
        self.db.refresh(decision)
        return self._decision_to_response(decision)

    def add_comment(
        self,
        version_id: UUID,
        payload: ArtifactCommentCreate,
    ) -> ArtifactCommentResponse | None:
        version = self._get_version_model(version_id)
        if version is None:
            return None

        comment = ArtifactCommentModel(
            id=str(uuid4()),
            version_id=version.id,
            author=payload.author,
            comment=payload.comment,
        )
        self.db.add(comment)
        self.db.commit()
        self.db.refresh(comment)
        return self._comment_to_response(comment)

    def get_version_history(self, version_id: UUID) -> ArtifactVersionHistoryResponse | None:
        statement = (
            select(ArtifactVersionModel)
            .where(ArtifactVersionModel.id == str(version_id))
            .options(
                selectinload(ArtifactVersionModel.decisions),
                selectinload(ArtifactVersionModel.comments),
            )
        )
        version = self.db.scalars(statement).first()
        if version is None:
            return None

        decisions = sorted(version.decisions, key=lambda decision: decision.created_at)
        comments = sorted(version.comments, key=lambda comment: comment.created_at)
        return ArtifactVersionHistoryResponse(
            version=self._version_to_response(version),
            decisions=[self._decision_to_response(decision) for decision in decisions],
            comments=[self._comment_to_response(comment) for comment in comments],
        )

    def compare_versions(
        self,
        base_version_id: UUID,
        target_version_id: UUID,
    ) -> VersionDiffResponse | None:
        base_version = self._get_version_model(base_version_id)
        target_version = self._get_version_model(target_version_id)

        if base_version is None or target_version is None:
            return None

        diff = list(
            unified_diff(
                base_version.content.splitlines(),
                target_version.content.splitlines(),
                fromfile=f"version {base_version.version}",
                tofile=f"version {target_version.version}",
                lineterm="",
            )
        )
        added_lines = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
        removed_lines = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))

        return VersionDiffResponse(
            base_version_id=UUID(base_version.id),
            target_version_id=UUID(target_version.id),
            base_version=base_version.version,
            target_version=target_version.version,
            added_lines=added_lines,
            removed_lines=removed_lines,
            diff=diff,
        )

    def add_evidence(
        self,
        version_id: UUID,
        payload: ArtifactEvidenceCreate,
    ) -> ArtifactEvidenceResponse | None:
        version = self._get_version_model(version_id)
        if version is None:
            return None

        evidence = ArtifactEvidenceModel(
            id=str(uuid4()),
            version_id=version.id,
            evidence_type=payload.evidence_type.value,
            source_title=payload.source_title,
            excerpt=payload.excerpt,
            activity_ref=payload.activity_ref,
            source_url=payload.source_url,
            notes=payload.notes,
        )
        self.db.add(evidence)
        self.db.commit()
        self.db.refresh(evidence)
        return self._evidence_to_response(evidence)

    def list_evidence(self, version_id: UUID) -> list[ArtifactEvidenceResponse] | None:
        version = self._get_version_model(version_id)
        if version is None:
            return None

        statement = (
            select(ArtifactEvidenceModel)
            .where(ArtifactEvidenceModel.version_id == str(version_id))
            .order_by(ArtifactEvidenceModel.created_at.desc())
        )
        evidences = self.db.scalars(statement).all()
        return [self._evidence_to_response(evidence) for evidence in evidences]

    def evaluate_quality(self, version_id: UUID) -> ArtifactQualityResponse | None:
        statement = (
            select(ArtifactVersionModel)
            .where(ArtifactVersionModel.id == str(version_id))
            .options(selectinload(ArtifactVersionModel.evidences))
        )
        version = self.db.scalars(statement).first()
        if version is None:
            return None

        content = version.content.lower()
        checks = [
            QualityCheckResponse(
                code="minimum_detail",
                label="Detalle minimo",
                passed=len(version.content.strip()) >= 80,
                detail="La version debe tener al menos 80 caracteres de contenido.",
            ),
            QualityCheckResponse(
                code="has_actor",
                label="Responsable o actor",
                passed=any(
                    word in content
                    for word in [
                        "responsable",
                        "usuario",
                        "cliente",
                        "area",
                        "compras",
                        "legal",
                        "tesoreria",
                        "contabilidad",
                        "solicitante",
                        "aprobador",
                    ]
                ),
                detail="Debe mencionar al menos un actor, rol o area del proceso.",
            ),
            QualityCheckResponse(
                code="has_flow_signal",
                label="Secuencia de flujo",
                passed=any(
                    word in content
                    for word in [
                        "desde",
                        "hasta",
                        "luego",
                        "despues",
                        "posterior",
                        "registra",
                        "revisa",
                        "valida",
                        "aprueba",
                    ]
                ),
                detail="Debe mostrar secuencia, accion o transicion entre actividades.",
            ),
            QualityCheckResponse(
                code="has_evidence",
                label="Evidencia vinculada",
                passed=len(version.evidences) > 0,
                detail="Debe tener al menos una evidencia asociada.",
            ),
        ]
        passed = sum(1 for check in checks if check.passed)
        score = round((passed / len(checks)) * 100)

        return ArtifactQualityResponse(
            version_id=UUID(version.id),
            score=score,
            checks=checks,
        )

    def _get_repository_model(self, case_id: UUID) -> ProcessRepositoryModel | None:
        statement = (
            select(ProcessRepositoryModel)
            .where(ProcessRepositoryModel.case_id == str(case_id))
            .options(selectinload(ProcessRepositoryModel.artifacts))
        )
        return self.db.scalars(statement).first()

    def _get_artifact_model(self, artifact_id: UUID) -> ProcessArtifactModel | None:
        statement = (
            select(ProcessArtifactModel)
            .where(ProcessArtifactModel.id == str(artifact_id))
            .options(selectinload(ProcessArtifactModel.versions))
        )
        return self.db.scalars(statement).first()

    def _get_version_model(self, version_id: UUID) -> ArtifactVersionModel | None:
        return self.db.get(ArtifactVersionModel, str(version_id))

    @staticmethod
    def _repository_to_response(repository: ProcessRepositoryModel) -> ProcessRepositoryResponse:
        return ProcessRepositoryResponse(
            id=UUID(repository.id),
            case_id=UUID(repository.case_id),
            name=repository.name,
            artifact_count=len(repository.artifacts),
            created_at=repository.created_at,
            updated_at=repository.updated_at,
        )

    @classmethod
    def _artifact_to_response(cls, artifact: ProcessArtifactModel) -> ProcessArtifactResponse:
        versions = sorted(artifact.versions, key=lambda version: version.created_at, reverse=True)
        return ProcessArtifactResponse(
            id=UUID(artifact.id),
            repository_id=UUID(artifact.repository_id),
            artifact_type=artifact.artifact_type,
            title=artifact.title,
            description=artifact.description,
            current_version_id=UUID(artifact.current_version_id) if artifact.current_version_id else None,
            created_at=artifact.created_at,
            updated_at=artifact.updated_at,
            versions=[cls._version_to_response(version) for version in versions],
        )

    @staticmethod
    def _version_to_response(version: ArtifactVersionModel) -> ArtifactVersionResponse:
        return ArtifactVersionResponse(
            id=UUID(version.id),
            artifact_id=UUID(version.artifact_id),
            version=version.version,
            status=version.status,
            content=version.content,
            change_summary=version.change_summary,
            author=version.author,
            content_hash=version.content_hash,
            created_at=version.created_at,
        )

    @staticmethod
    def _decision_to_response(decision: ArtifactDecisionModel) -> ArtifactDecisionResponse:
        return ArtifactDecisionResponse(
            id=UUID(decision.id),
            version_id=UUID(decision.version_id),
            action=ArtifactDecisionAction(decision.action),
            previous_status=ArtifactVersionStatus(decision.previous_status),
            new_status=ArtifactVersionStatus(decision.new_status),
            reviewer=decision.reviewer,
            comment=decision.comment,
            created_at=decision.created_at,
        )

    @staticmethod
    def _comment_to_response(comment: ArtifactCommentModel) -> ArtifactCommentResponse:
        return ArtifactCommentResponse(
            id=UUID(comment.id),
            version_id=UUID(comment.version_id),
            author=comment.author,
            comment=comment.comment,
            created_at=comment.created_at,
        )

    @staticmethod
    def _evidence_to_response(evidence: ArtifactEvidenceModel) -> ArtifactEvidenceResponse:
        return ArtifactEvidenceResponse(
            id=UUID(evidence.id),
            version_id=UUID(evidence.version_id),
            evidence_type=evidence.evidence_type,
            source_title=evidence.source_title,
            excerpt=evidence.excerpt,
            activity_ref=evidence.activity_ref,
            source_url=evidence.source_url,
            notes=evidence.notes,
            created_at=evidence.created_at,
        )
