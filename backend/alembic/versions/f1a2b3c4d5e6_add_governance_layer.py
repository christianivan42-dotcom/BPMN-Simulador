"""add_governance_layer

Revision ID: f1a2b3c4d5e6
Revises: e7f3b1c2d904
Create Date: 2026-05-24 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e7f3b1c2d904"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("username", sa.String(120), nullable=False, unique=True),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.String(40), nullable=False, server_default="viewer"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_role", "users", ["role"])

    op.create_table(
        "audit_trail",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor", sa.String(120), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("resource_type", sa.String(80), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=True),
        sa.Column("process_case_id", sa.String(36), nullable=True),
        sa.Column("diff", sa.Text, nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_trail_actor", "audit_trail", ["actor"])
    op.create_index("ix_audit_trail_action", "audit_trail", ["action"])
    op.create_index("ix_audit_trail_resource_type", "audit_trail", ["resource_type"])
    op.create_index("ix_audit_trail_resource_id", "audit_trail", ["resource_id"])
    op.create_index("ix_audit_trail_process_case_id", "audit_trail", ["process_case_id"])
    op.create_index("ix_audit_trail_created_at", "audit_trail", ["created_at"])

    op.create_table(
        "ai_explanations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("process_case_id", sa.String(36), sa.ForeignKey("process_cases.id", ondelete="CASCADE"), nullable=True),
        sa.Column("session_id", sa.String(36), nullable=False),
        sa.Column("agent_name", sa.String(120), nullable=False),
        sa.Column("recommendation", sa.Text, nullable=False),
        sa.Column("reasoning", sa.Text, nullable=False),
        sa.Column("evidence", sa.Text, nullable=True),
        sa.Column("methodology", sa.String(60), nullable=True),
        sa.Column("bpmn_element_id", sa.String(255), nullable=True),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_explanations_process_case_id", "ai_explanations", ["process_case_id"])
    op.create_index("ix_ai_explanations_session_id", "ai_explanations", ["session_id"])
    op.create_index("ix_ai_explanations_agent_name", "ai_explanations", ["agent_name"])
    op.create_index("ix_ai_explanations_created_at", "ai_explanations", ["created_at"])


def downgrade() -> None:
    op.drop_table("ai_explanations")
    op.drop_table("audit_trail")
    op.drop_table("users")
