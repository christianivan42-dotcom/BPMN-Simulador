"""
RAG Service (Retrieval-Augmented Generation)
============================================
Búsqueda semántica sobre los knowledge_chunks almacenados en la base de datos.

Estrategia de búsqueda (prioridad decreciente):
  1. Qdrant + sentence-transformers: si enable_qdrant=True y el servidor responde.
     Los chunks se sincronizan a Qdrant en la primera búsqueda (lazy indexing).
  2. sentence-transformers in-memory: si Qdrant no está disponible pero el modelo
     está instalado (InMemoryVectorStore).
  3. Ollama embeddings: si Ollama está corriendo localmente.
  4. TF-IDF: fallback determinístico sin dependencias de ML.
"""

from __future__ import annotations

import json
from app.core.logging import get_logger
import math
import re
from pathlib import Path
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.knowledge import KnowledgeChunkModel, KnowledgeDocumentModel

logger = get_logger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
VECTOR_STORE_DIR = PROJECT_ROOT / settings.vector_store_dir
TFIDF_INDEX_PATH = VECTOR_STORE_DIR / "tfidf_index.json"


class RAGFragment:
    """Fragmento recuperado con metadata de trazabilidad."""

    def __init__(
        self,
        chunk_id: str,
        document_id: str,
        document_title: str,
        author: str | None,
        content: str,
        score: float,
        chunk_index: int,
    ) -> None:
        self.chunk_id = chunk_id
        self.document_id = document_id
        self.document_title = document_title
        self.author = author
        self.content = content
        self.score = score
        self.chunk_index = chunk_index

    def as_context_text(self) -> str:
        """Formatea el fragmento para incluirlo en el prompt del LLM."""
        autor = f" — {self.author}" if self.author else ""
        return (
            f"[FUENTE: {self.document_title}{autor}, fragmento #{self.chunk_index}]\n"
            f"{self.content}"
        )

    def to_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "document_title": self.document_title,
            "author": self.author,
            "content": self.content[:400],
            "score": round(self.score, 4),
            "chunk_index": self.chunk_index,
        }


class RAGService:
    """
    Recupera fragmentos relevantes de la base de conocimiento.
    Usa TF-IDF como motor principal (sin dependencias de GPU/ML).
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        VECTOR_STORE_DIR.mkdir(parents=True, exist_ok=True)

    # ── Búsqueda principal ─────────────────────────────────────────────────────

    def buscar(
        self,
        query: str,
        top_k: int | None = None,
        case_id: UUID | None = None,
        subject_area: str | None = None,
    ) -> list[RAGFragment]:
        """
        Busca los fragmentos más relevantes para la consulta.

        Args:
            query:        Texto de la consulta del usuario.
            top_k:        Número máximo de resultados.
            case_id:      Si se especifica, filtra solo documentos de ese caso.
            subject_area: Si se especifica, filtra por área temática.
        """
        k = top_k or settings.rag_top_k
        chunks = self._load_chunks(case_id=case_id, subject_area=subject_area)
        if not chunks:
            return []

        # 1. Qdrant / sentence-transformers (backend semántico real)
        try:
            results = self._buscar_con_vector_store(query, chunks, k)
            if results:
                return results
        except Exception as exc:  # noqa: BLE001
            logger.warning("VectorStore falló, intentando Ollama: %s", exc)

        # 2. Ollama embeddings (fallback legacy)
        try:
            if self._ollama_disponible():
                return self._buscar_con_embeddings(query, chunks, k)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Embeddings Ollama fallaron, usando TF-IDF: %s", exc)

        # 3. TF-IDF (último recurso sin ML)
        return self._buscar_tfidf(query, chunks, k)

    def construir_contexto_rag(
        self,
        query: str,
        max_fragmentos: int | None = None,
        case_id: UUID | None = None,
    ) -> str:
        """
        Retorna un bloque de texto listo para incluir en el system prompt.
        """
        k = max_fragmentos or settings.chat_max_rag_fragments
        fragmentos = self.buscar(query, top_k=k, case_id=case_id)
        if not fragmentos:
            return ""

        lineas = ["## Conocimiento recuperado (RAG)"]
        for i, frag in enumerate(fragmentos, start=1):
            lineas.append(f"\n### Fragmento {i} (relevancia: {frag.score:.2f})")
            lineas.append(frag.as_context_text())
        return "\n".join(lineas)

    # ── Búsqueda semántica via VectorStore (Qdrant / in-memory) ──────────────

    def _buscar_con_vector_store(
        self,
        query: str,
        chunks: list[tuple[KnowledgeChunkModel, KnowledgeDocumentModel]],
        top_k: int,
    ) -> list[RAGFragment]:
        """
        Sincroniza los chunks de la BD al VectorStore (lazy) y ejecuta búsqueda
        semántica. Si sentence-transformers no está instalado, retorna lista vacía
        para que el caller caiga al siguiente nivel de fallback.
        """
        from app.memory.vector_store import get_vector_store

        store = get_vector_store()

        # Lazy indexing: solo indexar chunks que no estén ya en el store
        current_size = store.collection_size()
        if current_size < len(chunks):
            to_index = [
                {
                    "chunk_id": str(chunk.id),
                    "document_id": str(doc.id),
                    "document_title": doc.title,
                    "content": chunk.content,
                    "metadata": {
                        "chunk_index": chunk.chunk_index,
                        "author": doc.author or "",
                    },
                }
                for chunk, doc in chunks
            ]
            indexed = store.upsert_chunks_bulk(to_index)
            if indexed:
                logger.info("VectorStore: indexados %d chunks nuevos", indexed)

        hits = store.search(query, top_k=top_k)
        if not hits:
            return []

        # Enriquecer con score normalizado y chunk metadata desde BD
        chunk_map = {str(ch.id): (ch, doc) for ch, doc in chunks}
        results: list[RAGFragment] = []
        for hit in hits:
            pair = chunk_map.get(hit.chunk_id)
            if pair:
                chunk, doc = pair
                results.append(RAGFragment(
                    chunk_id=hit.chunk_id,
                    document_id=hit.document_id,
                    document_title=hit.document_title,
                    author=doc.author,
                    content=hit.content,
                    score=hit.score,
                    chunk_index=chunk.chunk_index,
                ))
        return results

    # ── Búsqueda TF-IDF (fallback sin dependencias de ML) ─────────────────────

    def _buscar_tfidf(
        self,
        query: str,
        chunks: list[tuple[KnowledgeChunkModel, KnowledgeDocumentModel]],
        top_k: int,
    ) -> list[RAGFragment]:
        query_tokens = self._tokenize(query)
        if not query_tokens:
            return []

        corpus = [self._tokenize(chunk.content) for chunk, _ in chunks]
        idf = self._compute_idf(corpus)

        query_tfidf = self._tfidf_vector(query_tokens, idf, corpus)
        scored: list[tuple[float, int]] = []

        for idx, doc_tokens in enumerate(corpus):
            doc_tfidf = self._tfidf_vector(doc_tokens, idf, corpus)
            score = self._cosine_similarity(query_tfidf, doc_tfidf)
            if score > 0:
                scored.append((score, idx))

        scored.sort(reverse=True)
        results: list[RAGFragment] = []
        for score, idx in scored[:top_k]:
            chunk, doc = chunks[idx]
            results.append(
                RAGFragment(
                    chunk_id=chunk.id,
                    document_id=doc.id,
                    document_title=doc.title,
                    author=doc.author,
                    content=chunk.content,
                    score=score,
                    chunk_index=chunk.chunk_index,
                )
            )
        return results

    # ── Búsqueda con embeddings Ollama ─────────────────────────────────────────

    def _buscar_con_embeddings(
        self,
        query: str,
        chunks: list[tuple[KnowledgeChunkModel, KnowledgeDocumentModel]],
        top_k: int,
    ) -> list[RAGFragment]:
        """Usa Ollama para generar embeddings y busca por similitud de coseno."""
        query_vec = self._embed_ollama(query)
        scored: list[tuple[float, int]] = []

        for idx, (chunk, _) in enumerate(chunks):
            doc_vec = self._embed_ollama(chunk.content[:512])
            score = self._cosine_similarity(query_vec, doc_vec)
            if score > 0:
                scored.append((score, idx))

        scored.sort(reverse=True)
        results: list[RAGFragment] = []
        for score, idx in scored[:top_k]:
            chunk, doc = chunks[idx]
            results.append(
                RAGFragment(
                    chunk_id=chunk.id,
                    document_id=doc.id,
                    document_title=doc.title,
                    author=doc.author,
                    content=chunk.content,
                    score=score,
                    chunk_index=chunk.chunk_index,
                )
            )
        return results

    def _embed_ollama(self, text: str) -> list[float]:
        with httpx.Client(timeout=3.0) as client:
            response = client.post(
                f"{settings.ollama_base_url}/api/embeddings",
                json={"model": settings.ollama_embedding_model, "prompt": text},
            )
            response.raise_for_status()
            data = response.json()
        embedding = data.get("embedding", [])
        return [float(v) for v in embedding]

    def _ollama_disponible(self) -> bool:
        try:
            response = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=2.0)
            return response.status_code < 500
        except httpx.HTTPError:
            return False

    # ── Carga de chunks desde BD ───────────────────────────────────────────────

    def _load_chunks(
        self,
        case_id: UUID | None,
        subject_area: str | None,
    ) -> list[tuple[KnowledgeChunkModel, KnowledgeDocumentModel]]:
        stmt = (
            select(KnowledgeChunkModel, KnowledgeDocumentModel)
            .join(KnowledgeDocumentModel, KnowledgeChunkModel.document_id == KnowledgeDocumentModel.id)
            .where(KnowledgeDocumentModel.status == "processed")
        )
        if case_id is not None:
            stmt = stmt.where(KnowledgeDocumentModel.case_id == str(case_id))
        if subject_area:
            stmt = stmt.where(KnowledgeDocumentModel.subject_area == subject_area)

        rows = self.db.execute(stmt).all()
        return [(row[0], row[1]) for row in rows]

    # ── TF-IDF helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        return re.findall(r"\b[a-záéíóúñüa-z]{3,}\b", text.lower())

    @staticmethod
    def _compute_idf(corpus: list[list[str]]) -> dict[str, float]:
        n = len(corpus)
        if n == 0:
            return {}
        doc_freq: dict[str, int] = {}
        for tokens in corpus:
            for token in set(tokens):
                doc_freq[token] = doc_freq.get(token, 0) + 1
        return {term: math.log((n + 1) / (freq + 1)) + 1 for term, freq in doc_freq.items()}

    @staticmethod
    def _tfidf_vector(tokens: list[str], idf: dict[str, float], corpus: list[list[str]]) -> dict[str, float]:
        n = len(corpus)
        if n == 0:
            return {}
        tf: dict[str, float] = {}
        for token in tokens:
            tf[token] = tf.get(token, 0) + 1
        total = len(tokens) or 1
        return {term: (count / total) * idf.get(term, 0) for term, count in tf.items()}

    @staticmethod
    def _cosine_similarity(a: dict[str, float] | list[float], b: dict[str, float] | list[float]) -> float:
        if isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                return 0.0
            dot = sum(x * y for x, y in zip(a, b))
            norm_a = math.sqrt(sum(x * x for x in a))
            norm_b = math.sqrt(sum(x * x for x in b))
            if norm_a == 0 or norm_b == 0:
                return 0.0
            return dot / (norm_a * norm_b)

        # Dict-based (TF-IDF)
        a_dict = a if isinstance(a, dict) else {}
        b_dict = b if isinstance(b, dict) else {}
        keys = set(a_dict) & set(b_dict)
        if not keys:
            return 0.0
        dot = sum(a_dict[k] * b_dict[k] for k in keys)
        norm_a = math.sqrt(sum(v * v for v in a_dict.values()))
        norm_b = math.sqrt(sum(v * v for v in b_dict.values()))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)
