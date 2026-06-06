from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.models import bpmn_overlay, chat, company, discovery, governance, knowledge, node_cognitive_context, orchestration, process_case, process_repository  # noqa: F401
from app.graph import models as _graph_models  # noqa: F401  - register graph tables


def _connect_args(database_url: str) -> dict[str, bool]:
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def _ensure_sqlite_parent(database_url: str) -> None:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix) or database_url == "sqlite:///:memory:":
        return

    db_path = Path(database_url.removeprefix(prefix))
    if not db_path.is_absolute():
        db_path = Path.cwd() / db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)


_active_url = settings.active_database_url
_ensure_sqlite_parent(_active_url)

engine = create_engine(
    _active_url,
    connect_args=_connect_args(_active_url),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _migrate_process_cases() -> None:
    from sqlalchemy import inspect, text

    try:
        with engine.connect() as conn:
            existing = {c["name"] for c in inspect(engine).get_columns("process_cases")}
            new_cols = [
                ("process_type", "VARCHAR(40)"),
                ("level", "INTEGER DEFAULT 1"),
                ("parent_id", "VARCHAR(36)"),
                ("map_status", "VARCHAR(40) DEFAULT 'identificado'"),
                # Análisis jerárquico bottom-up
                ("analysis_status", "VARCHAR(30) DEFAULT 'pendiente'"),
                ("staleness", "VARCHAR(30) DEFAULT 'ok'"),
                ("staleness_reason", "VARCHAR(500)"),
                ("staleness_since", "DATETIME"),
                ("last_analyzed_at", "DATETIME"),
                ("transversal", "BOOLEAN DEFAULT 0"),
                ("related_macro_ids", "TEXT"),
                # Definición de cadenas/flujos para N1 macro-procesos
                # JSON: [["n2-id-a","n2-id-b"], ["n2-id-c"], ...]
                ("flow_definition", "TEXT"),
            ]
            for col, typedef in new_cols:
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE process_cases ADD COLUMN {col} {typedef}"))
            conn.commit()
    except Exception:
        pass


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_process_cases()


def reset_db() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
