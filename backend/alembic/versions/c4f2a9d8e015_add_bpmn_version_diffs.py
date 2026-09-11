"""add_bpmn_version_diffs

Revision ID: c4f2a9d8e015
Revises: 3b161225b071
Create Date: 2026-05-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4f2a9d8e015'
down_revision: Union[str, Sequence[str], None] = '3b161225b071'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    from sqlalchemy import inspect
    bind = op.get_bind()
    if 'bpmn_version_diffs' not in inspect(bind).get_table_names():
        op.create_table(
            'bpmn_version_diffs',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('base_version_id', sa.String(length=36), nullable=False),
            sa.Column('target_version_id', sa.String(length=36), nullable=False),
            sa.Column('base_label', sa.String(length=40), nullable=False),
            sa.Column('target_label', sa.String(length=40), nullable=False),
            sa.Column('changes_json', sa.Text(), nullable=False),
            sa.Column('summary', sa.String(length=255), nullable=False),
            sa.Column('total_changes', sa.Integer(), nullable=False),
            sa.Column('computed_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['base_version_id'],   ['artifact_versions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['target_version_id'], ['artifact_versions.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_bpmn_version_diffs_base_version_id',   'bpmn_version_diffs', ['base_version_id'])
        op.create_index('ix_bpmn_version_diffs_target_version_id', 'bpmn_version_diffs', ['target_version_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_bpmn_version_diffs_target_version_id', table_name='bpmn_version_diffs')
    op.drop_index('ix_bpmn_version_diffs_base_version_id',   table_name='bpmn_version_diffs')
    op.drop_table('bpmn_version_diffs')
