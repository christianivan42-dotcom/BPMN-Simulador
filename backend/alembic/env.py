import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool

from alembic import context

# Añadir backend/ al sys.path para importar app.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models import (  # noqa: E402, F401
    bpmn_overlay,
    bpmn_version_diff,
    chat,
    company,
    discovery,
    knowledge,
    node_cognitive_context,
    orchestration,
    process_case,
    process_repository,
)
from app.graph import models as _graph_models  # noqa: E402, F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Apuntar a los metadatos del proyecto para autogenerate
target_metadata = Base.metadata

# Inyectar la URL activa (SQLite o PostgreSQL según USE_POSTGRES)
config.set_main_option("sqlalchemy.url", settings.active_database_url)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
