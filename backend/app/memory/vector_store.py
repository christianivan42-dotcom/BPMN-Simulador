"""
Vector Store Service — Qdrant adapter con fallback in-memory.

Responsabilidades:
  - Generar embeddings via sentence-transformers (all-MiniLM-L6-v2, 384 dims, sin GPU)
  - Indexar chunks de documentos en Qdrant (colección bpms_knowledge)
  - Buscar por similitud semántica dado un query string
  - Fallback in-memory (numpy cosine) cuando Qdrant no está disponible

Política de fallback:
  enable_qdrant=False  → siempre in-memory (dev sin Docker)
  enable_qdrant=True   → Qdrant; si el servidor no responde → in-memory + warning
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Tipos de resultado ────────────────────────────────────────────────────────

@dataclass
class VectorSearchResult:
    chunk_id: str
    document_id: str
    document_title: str
    content: str
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)


# ── Interfaz base ─────────────────────────────────────────────────────────────

class VectorStoreService:
    """ABC implícita: upsert_chunk, search, delete_by_document."""

    def upsert_chunk(
        self,
        chunk_id: str,
        document_id: str,
        document_title: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        raise NotImplementedError

    def upsert_chunks_bulk(self, chunks: list[dict[str, Any]]) -> int:
        """Inserta múltiples chunks; retorna cantidad indexada."""
        for chunk in chunks:
            self.upsert_chunk(**chunk)
        return len(chunks)

    def search(self, query: str, top_k: int = 5) -> list[VectorSearchResult]:
        raise NotImplementedError

    def delete_by_document(self, document_id: str) -> int:
        """Elimina todos los chunks de un documento; retorna cantidad eliminada."""
        raise NotImplementedError

    def collection_size(self) -> int:
        raise NotImplementedError


# ── Embedder compartido (cargado una sola vez) ────────────────────────────────

_embedder_lock = threading.Lock()
_embedder = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        with _embedder_lock:
            if _embedder is None:
                try:
                    from sentence_transformers import SentenceTransformer  # type: ignore
                    _embedder = SentenceTransformer(settings.qdrant_embedding_model)
                    logger.info("sentence-transformers cargado: %s", settings.qdrant_embedding_model)
                except ImportError:
                    logger.warning("sentence-transformers no instalado — embeddings no disponibles")
                    _embedder = None
    return _embedder


def _embed(text: str) -> list[float] | None:
    embedder = _get_embedder()
    if embedder is None:
        return None
    vec = embedder.encode(text, normalize_embeddings=True)
    return vec.tolist()


# ── Implementación Qdrant ─────────────────────────────────────────────────────

class QdrantVectorStore(VectorStoreService):
    """Adapter sobre qdrant-client. Crea la colección si no existe."""

    def __init__(self) -> None:
        from qdrant_client import QdrantClient  # type: ignore
        from qdrant_client.models import Distance, VectorParams  # type: ignore

        self._client = QdrantClient(url=settings.qdrant_url, timeout=10)
        col = settings.qdrant_collection
        dim = settings.qdrant_embedding_dim

        existing = {c.name for c in self._client.get_collections().collections}
        if col not in existing:
            self._client.create_collection(
                collection_name=col,
                vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
            )
            logger.info("Colección Qdrant creada: %s (dim=%d)", col, dim)

    def upsert_chunk(
        self,
        chunk_id: str,
        document_id: str,
        document_title: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        from qdrant_client.models import PointStruct  # type: ignore

        vec = _embed(content)
        if vec is None:
            logger.warning("Sin embedder — chunk %s no indexado en Qdrant", chunk_id)
            return

        payload = {
            "document_id": document_id,
            "document_title": document_title,
            "content": content,
            **(metadata or {}),
        }
        # Qdrant requiere IDs numéricos o UUIDs; usamos hash determinístico del chunk_id
        point_id = _chunk_id_to_int(chunk_id)
        self._client.upsert(
            collection_name=settings.qdrant_collection,
            points=[PointStruct(id=point_id, vector=vec, payload=payload)],
        )

    def search(self, query: str, top_k: int = 5) -> list[VectorSearchResult]:
        vec = _embed(query)
        if vec is None:
            return []

        hits = self._client.search(
            collection_name=settings.qdrant_collection,
            query_vector=vec,
            limit=top_k,
            with_payload=True,
        )
        results = []
        for hit in hits:
            p = hit.payload or {}
            results.append(VectorSearchResult(
                chunk_id=str(hit.id),
                document_id=p.get("document_id", ""),
                document_title=p.get("document_title", ""),
                content=p.get("content", ""),
                score=float(hit.score),
                metadata={k: v for k, v in p.items() if k not in ("document_id", "document_title", "content")},
            ))
        return results

    def delete_by_document(self, document_id: str) -> int:
        from qdrant_client.models import Filter, FieldCondition, MatchValue  # type: ignore

        result = self._client.delete(
            collection_name=settings.qdrant_collection,
            points_selector=Filter(
                must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
            ),
        )
        deleted = result.result.deleted if result.result else 0
        return deleted or 0

    def collection_size(self) -> int:
        info = self._client.get_collection(settings.qdrant_collection)
        return info.points_count or 0


def _chunk_id_to_int(chunk_id: str) -> int:
    """Convierte un UUID/string a int de 64 bits para Qdrant."""
    import hashlib
    digest = hashlib.sha256(chunk_id.encode()).digest()
    return int.from_bytes(digest[:8], "big") & 0x7FFFFFFFFFFFFFFF


# ── Implementación in-memory (fallback sin Qdrant) ────────────────────────────

class InMemoryVectorStore(VectorStoreService):
    """
    Fallback sin dependencia de Qdrant.
    Usa coseno numpy sobre embeddings cargados en RAM.
    Si sentence-transformers tampoco está disponible, degrada a TF-IDF (vacío).
    """

    def __init__(self) -> None:
        self._chunks: list[dict[str, Any]] = []
        self._vectors: list[list[float]] = []
        self._lock = threading.RLock()

    def upsert_chunk(
        self,
        chunk_id: str,
        document_id: str,
        document_title: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        vec = _embed(content)
        with self._lock:
            # Reemplazar si ya existe
            for i, ch in enumerate(self._chunks):
                if ch["chunk_id"] == chunk_id:
                    self._chunks[i] = {
                        "chunk_id": chunk_id, "document_id": document_id,
                        "document_title": document_title, "content": content,
                        **(metadata or {}),
                    }
                    if vec:
                        self._vectors[i] = vec
                    return
            self._chunks.append({
                "chunk_id": chunk_id, "document_id": document_id,
                "document_title": document_title, "content": content,
                **(metadata or {}),
            })
            self._vectors.append(vec or [])

    def search(self, query: str, top_k: int = 5) -> list[VectorSearchResult]:
        query_vec = _embed(query)
        if query_vec is None or not self._chunks:
            return []

        import math
        def cosine(a: list[float], b: list[float]) -> float:
            if len(a) != len(b):
                return 0.0
            dot = sum(x * y for x, y in zip(a, b))
            na = math.sqrt(sum(x * x for x in a))
            nb = math.sqrt(sum(x * x for x in b))
            return dot / (na * nb) if na and nb else 0.0

        with self._lock:
            scored = [
                (cosine(query_vec, v), i)
                for i, v in enumerate(self._vectors)
                if v
            ]
        scored.sort(reverse=True)
        results = []
        for score, idx in scored[:top_k]:
            ch = self._chunks[idx]
            results.append(VectorSearchResult(
                chunk_id=ch["chunk_id"],
                document_id=ch["document_id"],
                document_title=ch["document_title"],
                content=ch["content"],
                score=score,
                metadata={k: v for k, v in ch.items()
                          if k not in ("chunk_id", "document_id", "document_title", "content")},
            ))
        return results

    def delete_by_document(self, document_id: str) -> int:
        with self._lock:
            before = len(self._chunks)
            pairs = [(ch, v) for ch, v in zip(self._chunks, self._vectors)
                     if ch["document_id"] != document_id]
            if pairs:
                self._chunks, self._vectors = zip(*pairs)  # type: ignore
                self._chunks = list(self._chunks)
                self._vectors = list(self._vectors)
            else:
                self._chunks = []
                self._vectors = []
        return before - len(self._chunks)

    def collection_size(self) -> int:
        return len(self._chunks)


# ── Factory ───────────────────────────────────────────────────────────────────

_store_lock = threading.Lock()
_store_instance: VectorStoreService | None = None


def get_vector_store() -> VectorStoreService:
    """
    Singleton. Retorna QdrantVectorStore si enable_qdrant=True y el servidor
    responde; de lo contrario InMemoryVectorStore con warning.
    """
    global _store_instance
    if _store_instance is not None:
        return _store_instance

    with _store_lock:
        if _store_instance is not None:
            return _store_instance

        if settings.enable_qdrant:
            try:
                store = QdrantVectorStore()
                logger.info("VectorStore: usando Qdrant en %s", settings.qdrant_url)
                _store_instance = store
                return _store_instance
            except Exception as exc:
                logger.warning(
                    "Qdrant no disponible (%s) — fallback a InMemoryVectorStore", exc
                )

        logger.info("VectorStore: usando InMemoryVectorStore (fallback)")
        _store_instance = InMemoryVectorStore()
        return _store_instance
