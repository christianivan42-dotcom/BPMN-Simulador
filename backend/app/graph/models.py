"""
Property graph storage backed by SQLAlchemy.

GraphNodeModel: typed node with JSON properties
GraphEdgeModel: typed directed edge with JSON properties

Indexed by (type, key) for efficient traversal.
"""
from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NodeType(StrEnum):
    """Canonical organizational entity types."""
    # Estructura jerárquica
    COMPANY = "company"
    VALUE_CHAIN = "value_chain"
    MACRO_PROCESS = "macro_process"
    PROCESS = "process"
    SUBPROCESS = "subprocess"
    PROCEDURE = "procedure"
    INSTRUCTION = "instruction"
    RECORD = "record"
    # Recursos y artefactos
    DOCUMENT = "document"
    SYSTEM = "system"
    POLICY = "policy"
    KPI = "kpi"
    RISK = "risk"
    CONTROL = "control"
    # Actores
    AREA = "area"
    ROLE = "role"
    USER = "user"
    STAKEHOLDER = "stakeholder"
    # Eventos y métricas
    INCIDENT = "incident"
    EVENT = "event"
    METRIC = "metric"
    # Conocimiento
    INSIGHT = "insight"
    METHODOLOGY = "methodology"


class EdgeType(StrEnum):
    """Canonical relations between organizational entities."""
    # Jerárquicas
    BELONGS_TO = "belongs_to"          # procedure → subprocess → process → ...
    HAS_CHILD = "has_child"
    PART_OF = "part_of"
    # Dependencia
    DEPENDS_ON = "depends_on"
    BLOCKS = "blocks"
    TRIGGERS = "triggers"
    # Responsabilidad
    OWNS = "owns"                      # area owns process
    EXECUTES = "executes"               # user executes activity
    RESPONSIBLE_FOR = "responsible_for"
    APPROVES = "approves"
    # Documental
    SUPPORTS = "supports"               # document supports procedure
    DESCRIBES = "describes"
    REGULATES = "regulates"
    # Medición
    MEASURES = "measures"               # KPI measures process
    AFFECTS = "affects"                 # risk affects process
    MITIGATES = "mitigates"             # control mitigates risk
    # Conocimiento
    DERIVED_FROM = "derived_from"
    REFERENCES = "references"
    LEARNED_FROM = "learned_from"
    # Transversalidad
    APPLIES_TO = "applies_to"           # transversal process applies to multiple macros


class GraphNodeModel(Base):
    """A typed node in the organizational knowledge graph."""
    __tablename__ = "graph_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Type of entity (matches NodeType enum)
    type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    # Unique key within type (e.g. process id, doc id, user email)
    external_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    properties_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_graph_nodes_type_extkey", "type", "external_key"),
    )


class GraphEdgeModel(Base):
    """A typed directed edge between two graph nodes."""
    __tablename__ = "graph_edges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    target_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    properties_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    weight: Mapped[float] = mapped_column(default=1.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_graph_edges_src_type", "source_id", "type"),
        Index("ix_graph_edges_tgt_type", "target_id", "type"),
    )
