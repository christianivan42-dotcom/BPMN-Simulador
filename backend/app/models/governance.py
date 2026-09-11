from __future__ import annotations

# Este módulo albergaba también UserModel / AuditTrailModel y su API REST
# (/governance/*), que quedaron sin usar: la aplicación es de acceso libre y el
# frontend nunca llamaba a esos endpoints. Se eliminaron porque exponían
# creación, cambio de rol y borrado de usuarios SIN autenticación a cualquiera
# que alcanzase el puerto del backend.
#
# Se conserva AiExplanationModel: el orquestador cognitivo registra en él por qué
# un agente recomendó algo (ver app/services/explainability_service.py).

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AiExplanationModel(Base):
    """Record explaining why an AI agent made a specific recommendation.

    Stored per cognitive session turn, linked to a process_case and optionally
    to an agent name and BPMN element.
    """

    __tablename__ = "ai_explanations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)

    process_case_id: Mapped[str | None] = mapped_column(
        ForeignKey("process_cases.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # Name of the agent that produced the finding
    agent_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)

    # Short summary of the recommendation
    recommendation: Mapped[str] = mapped_column(Text, nullable=False)

    # Full reasoning chain (markdown / plain text)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)

    # Evidence snippets used (JSON list of strings)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Methodology applied: lean | six_sigma | toc | bpmn | general
    methodology: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)

    # Optional anchor to a BPMN element
    bpmn_element_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Confidence score 0-1 (optional, set by the agent when available)
    confidence: Mapped[float | None] = mapped_column(nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
    )
