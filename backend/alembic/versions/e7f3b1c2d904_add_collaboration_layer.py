"""add_collaboration_layer

Revision ID: e7f3b1c2d904
Revises: c4f2a9d8e015
Create Date: 2026-05-24 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7f3b1c2d904"
down_revision: Union[str, Sequence[str], None] = "c4f2a9d8e015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "approval_workflows",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("process_case_id", sa.String(36), sa.ForeignKey("process_cases.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("artifact_version_id", sa.String(36), sa.ForeignKey("artifact_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("requested_by", sa.String(120), nullable=False),
        sa.Column("assigned_to", sa.String(120), nullable=True),
        sa.Column("status", sa.String(40), nullable=False, server_default="pending"),
        sa.Column("rejection_reason", sa.Text, nullable=True),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_approval_workflows_process_case_id", "approval_workflows", ["process_case_id"])
    op.create_index("ix_approval_workflows_status", "approval_workflows", ["status"])

    op.create_table(
        "bpmn_comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("process_case_id", sa.String(36), sa.ForeignKey("process_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("artifact_version_id", sa.String(36), sa.ForeignKey("artifact_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approval_workflow_id", sa.String(36), sa.ForeignKey("approval_workflows.id", ondelete="SET NULL"), nullable=True),
        sa.Column("element_id", sa.String(255), nullable=True),
        sa.Column("author", sa.String(120), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("parent_id", sa.String(36), sa.ForeignKey("bpmn_comments.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_bpmn_comments_process_case_id", "bpmn_comments", ["process_case_id"])
    op.create_index("ix_bpmn_comments_element_id", "bpmn_comments", ["element_id"])
    op.create_index("ix_bpmn_comments_approval_workflow_id", "bpmn_comments", ["approval_workflow_id"])

    op.create_table(
        "notifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("recipient", sa.String(120), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=True),
        sa.Column("payload", sa.Text, nullable=True),
        sa.Column("channel", sa.String(40), nullable=False, server_default="in_app"),
        sa.Column("status", sa.String(40), nullable=False, server_default="pending"),
        sa.Column("error_detail", sa.Text, nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_notifications_recipient", "notifications", ["recipient"])
    op.create_index("ix_notifications_status", "notifications", ["status"])
    op.create_index("ix_notifications_event_type", "notifications", ["event_type"])


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("bpmn_comments")
    op.drop_table("approval_workflows")
