"""
KnowledgeGraphService — Abstract base + SQLite adapter.

Concrete implementations:
  SqliteKnowledgeGraphService — current implementation backed by SQLAlchemy/SQLite
  Neo4jKnowledgeGraphService  — Cypher-based implementation (Ola 3-A)

Use get_graph_service() factory (graph/factory.py) instead of
instantiating these directly.
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections import deque
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.graph.models import EdgeType, GraphEdgeModel, GraphNodeModel, NodeType


# ── Abstract Interface ─────────────────────────────────────────────────────────

class KnowledgeGraphService(ABC):
    """Common interface for all graph backend implementations."""

    @abstractmethod
    def upsert_node(
        self,
        type_: NodeType | str,
        external_key: str,
        label: str,
        properties: dict[str, Any] | None = None,
    ) -> Any: ...

    @abstractmethod
    def get_node(self, node_id: str) -> Any | None: ...

    @abstractmethod
    def find_node(self, type_: NodeType | str, external_key: str) -> Any | None: ...

    @abstractmethod
    def find_node_by_external(self, external_key: str) -> Any | None: ...

    @abstractmethod
    def nodes_by_type(self, type_: NodeType | str) -> list[Any]: ...

    @abstractmethod
    def upsert_edge(
        self,
        source_id: str,
        target_id: str,
        type_: EdgeType | str,
        properties: dict[str, Any] | None = None,
        weight: float = 1.0,
    ) -> Any: ...

    @abstractmethod
    def outgoing(self, node_id: str, edge_type: EdgeType | str | None = None) -> list[Any]: ...

    @abstractmethod
    def incoming(self, node_id: str, edge_type: EdgeType | str | None = None) -> list[Any]: ...

    @abstractmethod
    def neighbors(
        self,
        node_id: str,
        direction: str = "both",
        edge_type: EdgeType | str | None = None,
    ) -> list[Any]: ...

    @abstractmethod
    def subgraph(
        self,
        root_id: str,
        max_depth: int = 2,
        edge_types: list[EdgeType | str] | None = None,
    ) -> dict[str, Any]: ...

    @abstractmethod
    def shortest_path(self, source_id: str, target_id: str, max_depth: int = 5) -> list[str] | None: ...

    @abstractmethod
    def sync_from_process_cases(self) -> int: ...

    @abstractmethod
    def stats(self) -> dict[str, Any]: ...


# ── SQLite Adapter ─────────────────────────────────────────────────────────────

class SqliteKnowledgeGraphService(KnowledgeGraphService):
    """
    KnowledgeGraphService backed by SQLite/PostgreSQL via SQLAlchemy.
    Tables: graph_nodes, graph_edges.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    # ── Node CRUD ──────────────────────────────────────────────────────────────

    def upsert_node(
        self,
        type_: NodeType | str,
        external_key: str,
        label: str,
        properties: dict[str, Any] | None = None,
    ) -> GraphNodeModel:
        type_str = type_.value if isinstance(type_, NodeType) else type_
        stmt = select(GraphNodeModel).where(
            GraphNodeModel.type == type_str,
            GraphNodeModel.external_key == external_key,
        )
        existing = self.db.execute(stmt).scalar_one_or_none()
        if existing:
            existing.label = label
            if properties is not None:
                existing.properties_json = json.dumps(properties, ensure_ascii=False)
            self.db.commit()
            self.db.refresh(existing)
            return existing

        node = GraphNodeModel(
            id=str(uuid4()),
            type=type_str,
            external_key=external_key,
            label=label,
            properties_json=json.dumps(properties, ensure_ascii=False) if properties else None,
        )
        self.db.add(node)
        self.db.commit()
        self.db.refresh(node)
        return node

    def get_node(self, node_id: str) -> GraphNodeModel | None:
        return self.db.get(GraphNodeModel, node_id)

    def find_node(self, type_: NodeType | str, external_key: str) -> GraphNodeModel | None:
        type_str = type_.value if isinstance(type_, NodeType) else type_
        return self.db.execute(
            select(GraphNodeModel).where(
                GraphNodeModel.type == type_str,
                GraphNodeModel.external_key == external_key,
            )
        ).scalar_one_or_none()

    def find_node_by_external(self, external_key: str) -> GraphNodeModel | None:
        return self.db.execute(
            select(GraphNodeModel).where(GraphNodeModel.external_key == external_key)
        ).scalar_one_or_none()

    def nodes_by_type(self, type_: NodeType | str) -> list[GraphNodeModel]:
        type_str = type_.value if isinstance(type_, NodeType) else type_
        return list(self.db.execute(
            select(GraphNodeModel).where(GraphNodeModel.type == type_str)
        ).scalars().all())

    # ── Edge CRUD ──────────────────────────────────────────────────────────────

    def upsert_edge(
        self,
        source_id: str,
        target_id: str,
        type_: EdgeType | str,
        properties: dict[str, Any] | None = None,
        weight: float = 1.0,
    ) -> GraphEdgeModel:
        type_str = type_.value if isinstance(type_, EdgeType) else type_
        stmt = select(GraphEdgeModel).where(
            GraphEdgeModel.source_id == source_id,
            GraphEdgeModel.target_id == target_id,
            GraphEdgeModel.type == type_str,
        )
        existing = self.db.execute(stmt).scalar_one_or_none()
        if existing:
            existing.weight = weight
            if properties is not None:
                existing.properties_json = json.dumps(properties, ensure_ascii=False)
            self.db.commit()
            return existing

        edge = GraphEdgeModel(
            id=str(uuid4()),
            source_id=source_id,
            target_id=target_id,
            type=type_str,
            properties_json=json.dumps(properties, ensure_ascii=False) if properties else None,
            weight=weight,
        )
        self.db.add(edge)
        self.db.commit()
        return edge

    # ── Traversal ──────────────────────────────────────────────────────────────

    def outgoing(self, node_id: str, edge_type: EdgeType | str | None = None) -> list[GraphEdgeModel]:
        stmt = select(GraphEdgeModel).where(GraphEdgeModel.source_id == node_id)
        if edge_type:
            t = edge_type.value if isinstance(edge_type, EdgeType) else edge_type
            stmt = stmt.where(GraphEdgeModel.type == t)
        return list(self.db.execute(stmt).scalars().all())

    def incoming(self, node_id: str, edge_type: EdgeType | str | None = None) -> list[GraphEdgeModel]:
        stmt = select(GraphEdgeModel).where(GraphEdgeModel.target_id == node_id)
        if edge_type:
            t = edge_type.value if isinstance(edge_type, EdgeType) else edge_type
            stmt = stmt.where(GraphEdgeModel.type == t)
        return list(self.db.execute(stmt).scalars().all())

    def neighbors(
        self,
        node_id: str,
        direction: str = "both",
        edge_type: EdgeType | str | None = None,
    ) -> list[GraphNodeModel]:
        ids: set[str] = set()
        if direction in ("out", "both"):
            ids.update(e.target_id for e in self.outgoing(node_id, edge_type))
        if direction in ("in", "both"):
            ids.update(e.source_id for e in self.incoming(node_id, edge_type))
        if not ids:
            return []
        return list(self.db.execute(
            select(GraphNodeModel).where(GraphNodeModel.id.in_(ids))
        ).scalars().all())

    def subgraph(
        self,
        root_id: str,
        max_depth: int = 2,
        edge_types: list[EdgeType | str] | None = None,
    ) -> dict[str, Any]:
        """BFS N-hop subgraph for GraphRAG context injection."""
        visited_nodes: dict[str, GraphNodeModel] = {}
        visited_edges: list[GraphEdgeModel] = []
        queue: deque[tuple[str, int]] = deque([(root_id, 0)])

        edge_type_strs = None
        if edge_types:
            edge_type_strs = [
                t.value if isinstance(t, EdgeType) else t for t in edge_types
            ]

        while queue:
            current_id, depth = queue.popleft()
            if current_id in visited_nodes:
                continue
            node = self.get_node(current_id)
            if node is None:
                continue
            visited_nodes[current_id] = node
            if depth >= max_depth:
                continue
            for edge in self.outgoing(current_id):
                if edge_type_strs and edge.type not in edge_type_strs:
                    continue
                visited_edges.append(edge)
                if edge.target_id not in visited_nodes:
                    queue.append((edge.target_id, depth + 1))
            for edge in self.incoming(current_id):
                if edge_type_strs and edge.type not in edge_type_strs:
                    continue
                visited_edges.append(edge)
                if edge.source_id not in visited_nodes:
                    queue.append((edge.source_id, depth + 1))

        return {
            "nodes": [self._node_to_dict(n) for n in visited_nodes.values()],
            "edges": [self._edge_to_dict(e) for e in visited_edges],
            "depth": max_depth,
            "root_id": root_id,
        }

    def shortest_path(self, source_id: str, target_id: str, max_depth: int = 5) -> list[str] | None:
        """BFS shortest path; returns list of node ids."""
        if source_id == target_id:
            return [source_id]
        visited: dict[str, str | None] = {source_id: None}
        queue: deque[tuple[str, int]] = deque([(source_id, 0)])
        while queue:
            current_id, depth = queue.popleft()
            if depth >= max_depth:
                continue
            for edge in self.outgoing(current_id) + self.incoming(current_id):
                next_id = edge.target_id if edge.source_id == current_id else edge.source_id
                if next_id in visited:
                    continue
                visited[next_id] = current_id
                if next_id == target_id:
                    path = [next_id]
                    while path[-1] is not None and visited[path[-1]] is not None:
                        path.append(visited[path[-1]])  # type: ignore
                    return list(reversed(path))
                queue.append((next_id, depth + 1))
        return None

    def sync_from_process_cases(self) -> int:
        """Materializes process_cases tree as graph nodes + BELONGS_TO edges."""
        from app.models.process_case import ProcessCaseModel
        cases = list(self.db.execute(select(ProcessCaseModel)).scalars().all())
        level_to_type = {
            0: NodeType.VALUE_CHAIN,
            1: NodeType.MACRO_PROCESS,
            2: NodeType.PROCESS,
            3: NodeType.SUBPROCESS,
            4: NodeType.PROCEDURE,
            5: NodeType.INSTRUCTION,
            6: NodeType.RECORD,
        }
        synced = 0
        for case in cases:
            node_type = level_to_type.get(case.level or 2, NodeType.PROCESS)
            self.upsert_node(
                node_type,
                external_key=case.id,
                label=case.name,
                properties={
                    "level": case.level,
                    "owner": case.owner,
                    "area": case.area,
                    "analysis_status": case.analysis_status,
                    "staleness": case.staleness,
                    "transversal": bool(case.transversal),
                },
            )
            synced += 1
        for case in cases:
            if not case.parent_id:
                continue
            node = self.find_node_by_external(case.id)
            parent_node = self.find_node_by_external(case.parent_id)
            if node and parent_node:
                self.upsert_edge(node.id, parent_node.id, EdgeType.BELONGS_TO)
                self.upsert_edge(parent_node.id, node.id, EdgeType.HAS_CHILD)
        return synced

    def stats(self) -> dict[str, Any]:
        nodes = list(self.db.execute(select(GraphNodeModel)).scalars().all())
        edges = list(self.db.execute(select(GraphEdgeModel)).scalars().all())
        node_by_type: dict[str, int] = {}
        for n in nodes:
            node_by_type[n.type] = node_by_type.get(n.type, 0) + 1
        edge_by_type: dict[str, int] = {}
        for e in edges:
            edge_by_type[e.type] = edge_by_type.get(e.type, 0) + 1
        return {
            "backend": "sqlite",
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "nodes_by_type": node_by_type,
            "edges_by_type": edge_by_type,
        }

    @staticmethod
    def _node_to_dict(n: GraphNodeModel) -> dict[str, Any]:
        return {
            "id": n.id,
            "type": n.type,
            "external_key": n.external_key,
            "label": n.label,
            "properties": json.loads(n.properties_json) if n.properties_json else {},
        }

    @staticmethod
    def _edge_to_dict(e: GraphEdgeModel) -> dict[str, Any]:
        return {
            "id": e.id,
            "source_id": e.source_id,
            "target_id": e.target_id,
            "type": e.type,
            "weight": e.weight,
            "properties": json.loads(e.properties_json) if e.properties_json else {},
        }


# ── Neo4j Adapter ──────────────────────────────────────────────────────────────

class Neo4jKnowledgeGraphService(KnowledgeGraphService):
    """
    KnowledgeGraphService backed by Neo4j via the official neo4j Python driver.

    Requires: pip install neo4j
    Config: settings.neo4j_url (bolt://...), settings.neo4j_user, settings.neo4j_password

    The three canonical Cypher queries from KNOWLEDGE_GRAPH_ARCHITECTURE.md
    are exposed as impact_traversal(), bottleneck_resources(), and
    organizational_topology().
    """

    def __init__(self, url: str, user: str = "neo4j", password: str = "neo4j") -> None:
        try:
            from neo4j import GraphDatabase  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "neo4j package not installed. Run: pip install neo4j"
            ) from exc
        self._driver = GraphDatabase.driver(url, auth=(user, password))

    def close(self) -> None:
        self._driver.close()

    def _run(self, query: str, **params: Any) -> list[dict[str, Any]]:
        with self._driver.session() as session:
            result = session.run(query, **params)
            return [record.data() for record in result]

    # ── Node operations ────────────────────────────────────────────────────────

    def upsert_node(
        self,
        type_: NodeType | str,
        external_key: str,
        label: str,
        properties: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        type_str = type_.value if isinstance(type_, NodeType) else type_
        props = properties or {}
        props["external_key"] = external_key
        props["label"] = label
        cypher = (
            f"MERGE (n:{type_str} {{external_key: $external_key}}) "
            "SET n += $props "
            "RETURN elementId(n) AS id, n.external_key AS external_key, n.label AS label"
        )
        rows = self._run(cypher, external_key=external_key, props=props)
        return rows[0] if rows else {}

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        rows = self._run(
            "MATCH (n) WHERE elementId(n) = $id RETURN elementId(n) AS id, labels(n) AS types, n AS props",
            id=node_id,
        )
        return rows[0] if rows else None

    def find_node(self, type_: NodeType | str, external_key: str) -> dict[str, Any] | None:
        type_str = type_.value if isinstance(type_, NodeType) else type_
        rows = self._run(
            f"MATCH (n:{type_str} {{external_key: $key}}) "
            "RETURN elementId(n) AS id, n.external_key AS external_key, n.label AS label",
            key=external_key,
        )
        return rows[0] if rows else None

    def find_node_by_external(self, external_key: str) -> dict[str, Any] | None:
        rows = self._run(
            "MATCH (n {external_key: $key}) "
            "RETURN elementId(n) AS id, n.external_key AS external_key, n.label AS label LIMIT 1",
            key=external_key,
        )
        return rows[0] if rows else None

    def nodes_by_type(self, type_: NodeType | str) -> list[dict[str, Any]]:
        type_str = type_.value if isinstance(type_, NodeType) else type_
        return self._run(
            f"MATCH (n:{type_str}) "
            "RETURN elementId(n) AS id, n.external_key AS external_key, n.label AS label"
        )

    # ── Edge operations ────────────────────────────────────────────────────────

    def upsert_edge(
        self,
        source_id: str,
        target_id: str,
        type_: EdgeType | str,
        properties: dict[str, Any] | None = None,
        weight: float = 1.0,
    ) -> dict[str, Any]:
        type_str = (type_.value if isinstance(type_, EdgeType) else type_).upper()
        props = properties or {}
        props["weight"] = weight
        cypher = (
            "MATCH (a {external_key: $src}), (b {external_key: $tgt}) "
            f"MERGE (a)-[r:{type_str}]->(b) "
            "SET r += $props "
            "RETURN type(r) AS type"
        )
        rows = self._run(cypher, src=source_id, tgt=target_id, props=props)
        return rows[0] if rows else {}

    # ── Traversal ──────────────────────────────────────────────────────────────

    def outgoing(self, node_id: str, edge_type: EdgeType | str | None = None) -> list[dict[str, Any]]:
        rel = f"[r:{(edge_type.value if isinstance(edge_type, EdgeType) else edge_type).upper()}]" if edge_type else "[r]"
        return self._run(
            f"MATCH ({{external_key: $id}})-{rel}->(target) "
            "RETURN elementId(target) AS target_id, type(r) AS type, r.weight AS weight",
            id=node_id,
        )

    def incoming(self, node_id: str, edge_type: EdgeType | str | None = None) -> list[dict[str, Any]]:
        rel = f"[r:{(edge_type.value if isinstance(edge_type, EdgeType) else edge_type).upper()}]" if edge_type else "[r]"
        return self._run(
            f"MATCH (source)-{rel}->({{external_key: $id}}) "
            "RETURN elementId(source) AS source_id, type(r) AS type, r.weight AS weight",
            id=node_id,
        )

    def neighbors(
        self,
        node_id: str,
        direction: str = "both",
        edge_type: EdgeType | str | None = None,
    ) -> list[dict[str, Any]]:
        rel_type = f":{(edge_type.value if isinstance(edge_type, EdgeType) else edge_type).upper()}" if edge_type else ""
        if direction == "out":
            pattern = f"(n {{external_key: $id}})-[{rel_type}]->(neighbor)"
        elif direction == "in":
            pattern = f"(neighbor)-[{rel_type}]->(n {{external_key: $id}})"
        else:
            pattern = f"(n {{external_key: $id}})-[{rel_type}]-(neighbor)"
        return self._run(
            f"MATCH {pattern} "
            "RETURN DISTINCT elementId(neighbor) AS id, neighbor.external_key AS external_key, neighbor.label AS label",
            id=node_id,
        )

    def subgraph(
        self,
        root_id: str,
        max_depth: int = 2,
        edge_types: list[EdgeType | str] | None = None,
    ) -> dict[str, Any]:
        rel_filter = ""
        if edge_types:
            types_str = "|".join(
                (t.value if isinstance(t, EdgeType) else t).upper() for t in edge_types
            )
            rel_filter = f":{types_str}"
        rows = self._run(
            f"MATCH path = (root {{external_key: $id}})-[{rel_filter}*0..{max_depth}]-(neighbor) "
            "RETURN nodes(path) AS path_nodes, relationships(path) AS path_rels",
            id=root_id,
        )
        seen_nodes: dict[str, dict] = {}
        seen_edges: list[dict] = []
        for row in rows:
            for n in (row.get("path_nodes") or []):
                nid = str(n.element_id) if hasattr(n, "element_id") else str(n)
                if nid not in seen_nodes:
                    seen_nodes[nid] = {"id": nid, "label": dict(n).get("label", ""), "properties": dict(n)}
            for r in (row.get("path_rels") or []):
                seen_edges.append({"type": r.type, "weight": dict(r).get("weight", 1.0)})
        return {
            "nodes": list(seen_nodes.values()),
            "edges": seen_edges,
            "depth": max_depth,
            "root_id": root_id,
            "backend": "neo4j",
        }

    def shortest_path(self, source_id: str, target_id: str, max_depth: int = 5) -> list[str] | None:
        rows = self._run(
            f"MATCH path = shortestPath((a {{external_key: $src}})-[*1..{max_depth}]-(b {{external_key: $tgt}})) "
            "RETURN [n IN nodes(path) | n.external_key] AS path",
            src=source_id,
            tgt=target_id,
        )
        if rows and rows[0].get("path"):
            return rows[0]["path"]
        return None

    def sync_from_process_cases(self) -> int:
        """
        Sync process_cases from the relational DB into Neo4j.
        Requires a SQLAlchemy session — called via the factory which passes db.
        Since Neo4j service doesn't hold a db session, this is a no-op here;
        use SqliteKnowledgeGraphService.sync_from_process_cases() and then
        the graph agent will push entities via upsert_node/upsert_edge.
        """
        return 0

    def stats(self) -> dict[str, Any]:
        node_rows = self._run("MATCH (n) RETURN count(n) AS total_nodes")
        edge_rows = self._run("MATCH ()-[r]->() RETURN count(r) AS total_edges")
        label_rows = self._run(
            "MATCH (n) UNWIND labels(n) AS lbl RETURN lbl, count(*) AS cnt"
        )
        rel_rows = self._run(
            "MATCH ()-[r]->() RETURN type(r) AS rel_type, count(*) AS cnt"
        )
        return {
            "backend": "neo4j",
            "total_nodes": node_rows[0]["total_nodes"] if node_rows else 0,
            "total_edges": edge_rows[0]["total_edges"] if edge_rows else 0,
            "nodes_by_type": {r["lbl"]: r["cnt"] for r in label_rows},
            "edges_by_type": {r["rel_type"]: r["cnt"] for r in rel_rows},
        }

    # ── Canonical Cypher queries (KNOWLEDGE_GRAPH_ARCHITECTURE.md §3) ──────────

    def impact_traversal(self, process_name: str, max_hops: int = 3) -> list[dict[str, Any]]:
        """Query 1: ¿Qué procesos se ven afectados si el proceso X falla?"""
        return self._run(
            f"MATCH (a:ProcessCase {{label: $name}})-[:TRIGGERS*1..{max_hops}]->(impacted) "
            "RETURN impacted.label AS name, impacted.level AS level",
            name=process_name,
        )

    def bottleneck_resources(self, min_usage: int = 3) -> list[dict[str, Any]]:
        """Query 2: Recursos compartidos por más de N procesos (posibles cuellos de botella)."""
        return self._run(
            "MATCH (p:ProcessCase)-[:USES]->(r:Resource) "
            "WITH r, count(p) AS usage "
            "WHERE usage > $min_usage "
            "RETURN r.label AS resource, usage "
            "ORDER BY usage DESC",
            min_usage=min_usage,
        )

    def organizational_topology(self, macro_name: str) -> list[dict[str, Any]]:
        """Query 3: Vista completa de un macroproceso con áreas y roles."""
        return self._run(
            "MATCH (macro:ProcessCase {label: $name, level: 1}) "
            "MATCH (macro)-[:BELONGS_TO*]-(children:ProcessCase) "
            "MATCH (children)-[:OWNED_BY]->(areas:Area) "
            "MATCH (children)-[:PERFORMED_BY]->(roles:Role) "
            "RETURN macro.label AS macro, children.label AS process, "
            "areas.label AS area, roles.label AS role",
            name=macro_name,
        )
