"""add_bpmn_overlays

Revision ID: 3b161225b071
Revises: b7aedcb56c97
Create Date: 2026-05-24 03:34:36.588481

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3b161225b071'
down_revision: Union[str, Sequence[str], None] = 'b7aedcb56c97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    from sqlalchemy import inspect
    bind = op.get_bind()
    if 'bpmn_overlays' not in inspect(bind).get_table_names():
        op.create_table(
            'bpmn_overlays',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('artifact_version_id', sa.String(length=36), nullable=False),
            sa.Column('overlay_type', sa.String(length=40), nullable=False),
            sa.Column('element_id', sa.String(length=255), nullable=False),
            sa.Column('data', sa.Text(), nullable=False),
            sa.Column('visual', sa.Text(), nullable=True),
            sa.Column('created_by', sa.String(length=120), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['artifact_version_id'], ['artifact_versions.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_bpmn_overlays_artifact_version_id', 'bpmn_overlays', ['artifact_version_id'])
        op.create_index('ix_bpmn_overlays_overlay_type', 'bpmn_overlays', ['overlay_type'])
        op.create_index('ix_bpmn_overlays_element_id', 'bpmn_overlays', ['element_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_bpmn_overlays_element_id', table_name='bpmn_overlays')
    op.drop_index('ix_bpmn_overlays_overlay_type', table_name='bpmn_overlays')
    op.drop_index('ix_bpmn_overlays_artifact_version_id', table_name='bpmn_overlays')
    op.drop_table('bpmn_overlays')
