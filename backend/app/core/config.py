from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Agente BPMS - Experto en Procesos"
    app_version: str = "1.2.0"
    app_env: str = "local"
    api_prefix: str = "/api/v1"
    frontend_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
            "http://localhost:5175",
            "http://127.0.0.1:5175",
            "http://localhost:5176",
            "http://127.0.0.1:5176",
            "http://localhost:5177",
            "http://127.0.0.1:5177",
            "http://localhost:5178",
            "http://127.0.0.1:5178",
        ]
    )

    # ── Base de datos ──────────────────────────────────────────────────────────
    use_postgres: bool = False
    # Cuando use_postgres=True se usa postgres_url; de lo contrario database_url (SQLite)
    postgres_url: str = "postgresql://bpms:bpms@localhost:5432/bpms"
    database_url: str = "sqlite:///./storage/app.db"

    @property
    def active_database_url(self) -> str:
        return self.postgres_url if self.use_postgres else self.database_url
    document_storage_dir: str = "storage/documents"
    agent_training_dir: str = "docs/agent-training"
    obsidian_vault_dir: str = "storage/obsidian-bpm-vault"
    vector_store_dir: str = "storage/vector_store"

    # ── Ollama (LLM Local) ────────────────────────────────────────────────────
    local_llm_provider: str = "ollama"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_reasoning_model: str = "deepseek-r1:32b"
    ollama_reasoning_model_upgrade: str = "deepseek-r1:32b"
    ollama_coder_model: str = "deepseek-coder-v2"
    ollama_fast_model: str = "qwen2.5-coder:7b"
    ollama_embedding_model: str = "qwen3-embedding:0.6b"
    ollama_embedding_model_upgrade: str = "qwen3-embedding:4b"

    # ── Gemini (Google AI Studio — gratuito) ──────────────────────────────────
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-pro-latest"
    gemini_flash_model: str = "gemini-2.5-flash-latest"

    # ── Deepseek API (casi gratuito) ──────────────────────────────────────────
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"

    # ── Groq (gratuito, rápido) ───────────────────────────────────────────────
    groq_api_key: str = ""
    groq_model: str = "meta-llama/llama-4-scout"

    # ── RAG / Embeddings ──────────────────────────────────────────────────────
    rag_top_k: int = 5
    rag_chunk_size: int = 1200
    rag_chunk_overlap: int = 160

    # ── Chat ──────────────────────────────────────────────────────────────────
    chat_max_history: int = 20
    chat_max_rag_fragments: int = 5

    # ── Knowledge Graph (Neo4j) ───────────────────────────────────────────────
    enable_neo4j: bool = False
    neo4j_url: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "neo4j_bpms"

    # ── Vector Store (Qdrant) ─────────────────────────────────────────────────
    enable_qdrant: bool = False
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "bpms_knowledge"
    # Modelo sentence-transformers usado para embeddings locales (sin GPU)
    qdrant_embedding_model: str = "all-MiniLM-L6-v2"
    qdrant_embedding_dim: int = 384

    # ── Collaboration Layer (Ola 3-C) ─────────────────────────────────────────
    # Email — stub en Ola 3-C, activar en Ola 4 con SMTP/SendGrid
    notifications_email_from: str = "no-reply@bpms.local"
    notifications_smtp_host: str = ""
    notifications_smtp_port: int = 587
    notifications_smtp_user: str = ""
    notifications_smtp_password: str = ""
    # Webhook — URL base para push notifications (stub en Ola 3-C)
    notifications_webhook_url: str = ""

    # ── Governance: RBAC + Audit Trail (Ola 3-D) ─────────────────────────────
    # Secret used for API token signing — swap for a real secret in production
    governance_secret: str = "change-me-in-production-ola4"
    # Default admin user created on first boot (if no users exist)
    default_admin_username: str = "admin"
    default_admin_email: str = "admin@bpms.local"
    default_admin_password: str = "admin1234"

    # ── Redis / Event Bus (Ola 4) ─────────────────────────────────────────────
    redis_url: str = ""  # vacío = in-process EventBus; "redis://localhost:6379" = Redis Streams
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ── OpenTelemetry (Ola 4) ─────────────────────────────────────────────────
    otel_enabled: bool = False
    otel_exporter_otlp_endpoint: str = "http://localhost:4317"
    otel_service_name: str = "bpms-backend"

    # ── Modo demo / mock ──────────────────────────────────────────────────────
    use_mock_llm: bool = False

    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
