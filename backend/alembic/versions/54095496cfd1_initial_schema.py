"""initial_schema

Revision ID: 54095496cfd1
Revises:
Create Date: 2026-05-24 03:09:53.981762

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import reflection


# revision identifiers, used by Alembic.
revision: str = '54095496cfd1'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_exists(index_name: str, table_name: str) -> bool:
    bind = op.get_bind()
    insp = reflection.Inspector.from_engine(bind)
    return any(ix["name"] == index_name for ix in insp.get_indexes(table_name))


def upgrade() -> None:
    """Represent the baseline schema already applied to existing SQLite DBs.

    The NOT NULL constraints on process_cases were added via raw ALTER TABLE
    in session._migrate_process_cases(), which SQLite accepted at creation time
    but Alembic cannot re-apply via ALTER COLUMN (SQLite limitation).
    We only apply the index, which is idempotent and SQLite-compatible.
    On a fresh PostgreSQL DB, Base.metadata.create_all() handles the full schema
    before Alembic runs, so this migration just stamps the baseline.
    """
    if not _index_exists("ix_process_cases_parent_id", "process_cases"):
        op.create_index(
            op.f("ix_process_cases_parent_id"),
            "process_cases",
            ["parent_id"],
            unique=False,
        )


def downgrade() -> None:
    if _index_exists("ix_process_cases_parent_id", "process_cases"):
        op.drop_index(
            op.f("ix_process_cases_parent_id"),
            table_name="process_cases",
        )
