"""
Organizational Knowledge Graph.

In-DB property-graph representation of the organization.
Nodes typed by entity (Process, Document, User, Risk, KPI, etc.).
Edges typed by relation (DEPENDS_ON, OWNS, MEASURES, AFFECTS, etc.).

Use get_graph_service(db) to get the active backend (SQLite or Neo4j).
"""
from app.graph.factory import get_graph_service
from app.graph.models import EdgeType, GraphEdgeModel, GraphNodeModel, NodeType
from app.graph.service import KnowledgeGraphService, Neo4jKnowledgeGraphService, SqliteKnowledgeGraphService

__all__ = [
    "GraphNodeModel",
    "GraphEdgeModel",
    "NodeType",
    "EdgeType",
    "KnowledgeGraphService",
    "SqliteKnowledgeGraphService",
    "Neo4jKnowledgeGraphService",
    "get_graph_service",
]
