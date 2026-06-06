"""add_node_cognitive_contexts

Revision ID: b7aedcb56c97
Revises: 54095496cfd1
Create Date: 2026-05-24 03:24:03.676167

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7aedcb56c97'
down_revision: Union[str, Sequence[str], None] = '54095496cfd1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'node_cognitive_contexts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('key_facts', sa.Text(), nullable=True),
        sa.Column('findings', sa.Text(), nullable=True),
        sa.Column('open_questions', sa.Text(), nullable=True),
        sa.Column('methodology_applied', sa.Text(), nullable=True),
        sa.Column('inherited_context', sa.Text(), nullable=True),
        sa.Column('last_session_id', sa.String(length=36), nullable=True),
        sa.Column('sessions_count', sa.Integer(), nullable=False),
        sa.Column('last_analyzed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('node_cognitive_contexts')
