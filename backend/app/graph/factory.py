"""
Graph service factory.

Usage:
    graph = get_graph_service(db)   # in FastAPI dependency or orchestrator

Selects Neo4j when settings.enable_neo4j=True; falls back to SQLite if Neo4j
is unavailable or the driver is not installed.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.graph.service import KnowledgeGraphService, Neo4jKnowledgeGraphService, SqliteKnowledgeGraphService

logger = logging.getLogger(__name__)


def get_graph_service(db: Session) -> KnowledgeGraphService:
    """
    Return the appropriate KnowledgeGraphService implementation.

    - settings.enable_neo4j=True → Neo4jKnowledgeGraphService (with SQLite fallback)
    - otherwise              → SqliteKnowledgeGraphService
    """
    from app.core.config import settings  # local import avoids circular deps

    if not settings.enable_neo4j:
        return SqliteKnowledgeGraphService(db)

    try:
        svc = Neo4jKnowledgeGraphService(
            url=settings.neo4j_url,
            user=settings.neo4j_user,
            password=settings.neo4j_password,
        )
        # Smoke-test the connection
        svc.stats()
        return svc
    except Exception as exc:
        logger.warning(
            "Neo4j unavailable (%s). Falling back to SQLite graph backend.", exc
        )
        return SqliteKnowledgeGraphService(db)
