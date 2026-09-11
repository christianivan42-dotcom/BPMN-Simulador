from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NodeCognitiveContextModel(Base):
    """Persistent cognitive context for a BPM node (ProcessCase).

    Survives across chat sessions so agents inherit accumulated knowledge
    each time the same node is revisited (Node-Centric Architecture, ADR-001).
    """

    __tablename__ = "node_cognitive_contexts"

    # PK == process_case_id (one context per node)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)

    # JSON arrays / objects stored as text (SQLite-compatible; PostgreSQL can use JSON)
    key_facts: Mapped[str | None] = mapped_column(Text, nullable=True)          # list[str]
    findings: Mapped[str | None] = mapped_column(Text, nullable=True)           # list[dict]
    open_questions: Mapped[str | None] = mapped_column(Text, nullable=True)     # list[str]
    methodology_applied: Mapped[str | None] = mapped_column(Text, nullable=True) # list[str]
    inherited_context: Mapped[str | None] = mapped_column(Text, nullable=True)  # dict from parent

    last_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sessions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    last_analyzed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
