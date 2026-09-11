from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.logging import get_logger
from app.db.base import Base
from app.models import bpmn_diagram, bpmn_overlay, chat, company, discovery, governance, knowledge, node_cognitive_context, orchestration, process_case, process_repository  # noqa: F401
from app.graph import models as _graph_models  # noqa: F401  - register graph tables


logger = get_logger(__name__)


def _connect_args(database_url: str) -> dict[str, object]:
    if database_url.startswith("sqlite"):
        # `timeout` evita el "database is locked" inmediato cuando dos peticiones
        # escriben a la vez: SQLite espera hasta 15 s a que se libere el lock en
        # lugar de fallar al instante.
        return {"check_same_thread": False, "timeout": 15}
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

if _active_url.startswith("sqlite") and _active_url != "sqlite:///:memory:":
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record) -> None:  # noqa: ANN001
        """WAL permite leer mientras otra conexión escribe.

        Con el journal por defecto, cualquier escritura bloquea toda la base y
        con dos pestañas abiertas aparecían errores "database is locked".
        """
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()

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
            added = []
            for col, typedef in new_cols:
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE process_cases ADD COLUMN {col} {typedef}"))
                    added.append(col)
            conn.commit()
            if added:
                logger.info("db.migrated_process_cases", columns=added)
    except Exception as exc:  # noqa: BLE001
        # Antes esto era `pass`: si la migración fallaba, la app arrancaba con un
        # esquema incompleto y el error real solo se veía como un 500 opaco más
        # tarde. Ahora al menos queda registrado.
        logger.warning("db.migrate_process_cases_failed", error=str(exc))


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
