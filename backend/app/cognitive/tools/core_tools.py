"""
Core tools registered at startup.

Tools available to any agent:
    - graph.search_node       — find node by type+name
    - graph.neighbors         — get neighbors of a node
    - graph.subgraph          — N-hop subgraph for context
    - org.snapshot            — organizational state snapshot
    - org.process_tree        — current hierarchical tree
    - rag.search              — semantic search of documents
    - memory.episodic.recent  — last N conversation turns
    - memory.semantic.search  — search learned facts
    - blackboard.read         — read entries by topic
    - kpi.aggregate           — aggregate metrics for a process
    - bottleneck.detect       — naive bottleneck analysis
"""
from __future__ import annotations

from typing import Any

from app.cognitive.tools.registry import TOOL_REGISTRY, Tool


# ── Graph tools ──────────────────────────────────────────────────────────────

def _tool_graph_search(args: dict[str, Any], ctx) -> dict[str, Any]:
    node_type = args.get("type")
    external_key = args.get("external_key")
    if external_key:
        node = ctx.graph.find_node_by_external(external_key)
        if node:
            return {"found": True, "node": ctx.graph._node_to_dict(node)}
    if node_type:
        nodes = ctx.graph.nodes_by_type(node_type)
        return {"found": len(nodes) > 0, "count": len(nodes),
                "nodes": [ctx.graph._node_to_dict(n) for n in nodes[:20]]}
    return {"found": False, "error": "Provide 'type' or 'external_key'"}


def _tool_graph_neighbors(args: dict[str, Any], ctx) -> dict[str, Any]:
    node_id = args.get("node_id")
    direction = args.get("direction", "both")
    edge_type = args.get("edge_type")
    if not node_id:
        return {"error": "node_id required"}
    nbrs = ctx.graph.neighbors(node_id, direction=direction, edge_type=edge_type)
    return {"count": len(nbrs), "neighbors": [ctx.graph._node_to_dict(n) for n in nbrs]}


def _tool_graph_subgraph(args: dict[str, Any], ctx) -> dict[str, Any]:
    node_id = args.get("node_id")
    depth = int(args.get("depth", 2))
    if not node_id:
        return {"error": "node_id required"}
    return ctx.graph.subgraph(node_id, max_depth=depth)


# ── Organizational tools ─────────────────────────────────────────────────────

def _tool_org_snapshot(args: dict[str, Any], ctx) -> dict[str, Any]:
    snap = ctx.organizational_memory.snapshot()
    return {
        "company": snap.company,
        "porter_chain": snap.porter_chain,
        "macro_processes": snap.macro_processes,
        "process_tree_count": len(snap.process_tree),
        "stale_count": snap.stale_analyses_count,
        "total_documents": snap.total_documents,
    }


def _tool_org_process_tree(args: dict[str, Any], ctx) -> dict[str, Any]:
    from app.services.process_case_service import ProcessCaseService
    svc = ProcessCaseService(ctx.db)
    tree = svc.get_tree()
    # Serializar a dict para JSON
    def _ser(node):
        return {
            "id": str(node.id),
            "name": node.name,
            "level": node.level,
            "analysis_status": node.analysis_status.value,
            "staleness": node.staleness.value,
            "transversal": node.transversal,
            "children": [_ser(c) for c in node.children],
        }
    return {"tree": [_ser(n) for n in tree]}


# ── Memory tools ─────────────────────────────────────────────────────────────

def _tool_memory_episodic_recent(args: dict[str, Any], ctx) -> dict[str, Any]:
    from app.cognitive.memory.episodic import EPISODIC_MEMORY
    n = int(args.get("n", 5))
    turns = EPISODIC_MEMORY.session_turns(ctx.session_id, last_n=n)
    return {"turns": [t.to_dict() for t in turns]}


def _tool_memory_semantic_search(args: dict[str, Any], ctx) -> dict[str, Any]:
    from app.cognitive.memory.semantic import SEMANTIC_MEMORY
    terms = args.get("terms", [])
    if isinstance(terms, str):
        terms = terms.split()
    facts = SEMANTIC_MEMORY.search(terms)
    return {"facts": [
        {
            "id": f.id, "statement": f.statement, "topic": f.topic,
            "confidence": f.confidence, "support": f.support_count,
        }
        for f in facts[:10]
    ]}


# ── Blackboard tools ─────────────────────────────────────────────────────────

def _tool_blackboard_read(args: dict[str, Any], ctx) -> dict[str, Any]:
    topic = args.get("topic")
    if topic:
        entries = ctx.shared_state.by_topic(topic)
    else:
        entries = ctx.shared_state.all_entries()
    return {
        "count": len(entries),
        "entries": [
            {
                "id": e.id, "topic": e.topic, "agent": e.agent,
                "content": e.content, "confidence": e.confidence,
                "version": e.version,
            }
            for e in entries[-20:]
        ],
    }


# ── RAG tool ─────────────────────────────────────────────────────────────────

def _tool_rag_search(args: dict[str, Any], ctx) -> dict[str, Any]:
    from app.services.rag_service import RAGService
    query = args.get("query", "")
    top_k = int(args.get("top_k", 5))
    if not query:
        return {"error": "query required"}
    rag = RAGService(ctx.db)
    fragments = rag.buscar(query, top_k=top_k)
    return {
        "query": query,
        "fragments": [
            {
                "document_title": f.document_title,
                "content": f.content[:500],
                "score": f.score,
            }
            for f in fragments
        ],
    }


def _tool_rag_reindex(args: dict[str, Any], ctx) -> dict[str, Any]:
    from uuid import UUID
    from app.services.rag_service import RAGService
    from app.memory.vector_store import get_vector_store

    case_id_str = args.get("case_id")
    case_id = UUID(case_id_str) if case_id_str else None

    rag = RAGService(ctx.db)
    chunks = rag._load_chunks(case_id=case_id, subject_area=None)
    if not chunks:
        return {"indexed": 0, "message": "No hay chunks procesados para indexar."}

    store = get_vector_store()
    to_index = [
        {
            "chunk_id": str(chunk.id),
            "document_id": str(doc.id),
            "document_title": doc.title,
            "content": chunk.content,
            "metadata": {"chunk_index": chunk.chunk_index, "author": doc.author or ""},
        }
        for chunk, doc in chunks
    ]
    indexed = store.upsert_chunks_bulk(to_index)
    return {"indexed": indexed, "total_chunks": len(chunks)}


# ── KPI / bottleneck (placeholder semantic implementations) ──────────────────

def _tool_kpi_aggregate(args: dict[str, Any], ctx) -> dict[str, Any]:
    """Stub: in real life would compute from event logs. Returns mock data based on process metadata."""
    process_id = args.get("process_id")
    return {
        "process_id": process_id,
        "kpis": {
            "tiempo_ciclo_horas": "no calculado — falta event log",
            "tasa_defectos_pct": "no calculado",
            "throughput_dia": "no calculado",
        },
        "note": "Conecta event logs (process_mining) para KPIs reales.",
    }


def _tool_bottleneck_detect(args: dict[str, Any], ctx) -> dict[str, Any]:
    """Detect candidates by looking at stale + complexity."""
    snapshot = ctx.organizational_memory.snapshot()
    candidates = [
        p for p in snapshot.process_tree
        if p.get("staleness") and p["staleness"] != "ok"
    ]
    return {
        "candidates_count": len(candidates),
        "candidates": candidates[:10],
        "criteria": "Procesos con staleness != ok (cambios sin re-analizar).",
    }


# ── Register all ─────────────────────────────────────────────────────────────

TOOL_REGISTRY.register(Tool(
    name="graph.search_node",
    description="Buscar un nodo en el grafo organizacional por tipo o external_key.",
    input_schema={"type": "object", "properties": {"type": {"type": "string"}, "external_key": {"type": "string"}}},
    runner=_tool_graph_search,
    category="graph",
))

TOOL_REGISTRY.register(Tool(
    name="graph.neighbors",
    description="Obtener los vecinos directos de un nodo (in/out/both).",
    input_schema={"type": "object", "properties": {"node_id": {"type": "string"}, "direction": {"type": "string"}, "edge_type": {"type": "string"}}, "required": ["node_id"]},
    runner=_tool_graph_neighbors,
    category="graph",
))

TOOL_REGISTRY.register(Tool(
    name="graph.subgraph",
    description="Extraer subgrafo N-hop desde un nodo raíz (GraphRAG context).",
    input_schema={"type": "object", "properties": {"node_id": {"type": "string"}, "depth": {"type": "integer", "default": 2}}, "required": ["node_id"]},
    runner=_tool_graph_subgraph,
    category="graph",
    cost_estimate="medium",
))

TOOL_REGISTRY.register(Tool(
    name="org.snapshot",
    description="Snapshot del estado organizacional actual (empresa, Porter, macros, árbol).",
    input_schema={"type": "object", "properties": {}},
    runner=_tool_org_snapshot,
    category="general",
))

TOOL_REGISTRY.register(Tool(
    name="org.process_tree",
    description="Árbol jerárquico completo de procesos con estado de análisis y staleness.",
    input_schema={"type": "object", "properties": {}},
    runner=_tool_org_process_tree,
    category="general",
))

TOOL_REGISTRY.register(Tool(
    name="memory.episodic.recent",
    description="Últimas N interacciones de la sesión actual (memoria episódica).",
    input_schema={"type": "object", "properties": {"n": {"type": "integer", "default": 5}}},
    runner=_tool_memory_episodic_recent,
    category="memory",
))

TOOL_REGISTRY.register(Tool(
    name="memory.semantic.search",
    description="Buscar hechos aprendidos por términos clave (memoria semántica).",
    input_schema={"type": "object", "properties": {"terms": {"type": "array", "items": {"type": "string"}}}, "required": ["terms"]},
    runner=_tool_memory_semantic_search,
    category="memory",
))

TOOL_REGISTRY.register(Tool(
    name="blackboard.read",
    description="Leer entradas del blackboard de la sesión (por tópico o todas).",
    input_schema={"type": "object", "properties": {"topic": {"type": "string"}}},
    runner=_tool_blackboard_read,
    category="memory",
))

TOOL_REGISTRY.register(Tool(
    name="rag.search",
    description="Búsqueda semántica en la base de conocimiento documental (libros, normas).",
    input_schema={"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer", "default": 5}}, "required": ["query"]},
    runner=_tool_rag_search,
    category="document",
    cost_estimate="medium",
))

TOOL_REGISTRY.register(Tool(
    name="rag.reindex",
    description="Re-indexa todos los documentos procesados en el VectorStore (Qdrant/in-memory). Usar cuando se suben documentos nuevos.",
    input_schema={"type": "object", "properties": {"case_id": {"type": "string"}}},
    runner=_tool_rag_reindex,
    category="document",
    cost_estimate="high",
))

TOOL_REGISTRY.register(Tool(
    name="kpi.aggregate",
    description="Agregar KPIs de un proceso (necesita event logs).",
    input_schema={"type": "object", "properties": {"process_id": {"type": "string"}}, "required": ["process_id"]},
    runner=_tool_kpi_aggregate,
    category="analytics",
))

TOOL_REGISTRY.register(Tool(
    name="bottleneck.detect",
    description="Detecta candidatos a cuello de botella en el árbol de procesos.",
    input_schema={"type": "object", "properties": {}},
    runner=_tool_bottleneck_detect,
    category="analytics",
))
