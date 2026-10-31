"""edge serial: detection images/hardware status, edge telemetry, real waste classes

Revision ID: e1d9e0a7c001
Revises: bbe2ecfec0d9
Create Date: 2026-10-31 23:00:00

실제 YOLO 모델(best_model.pt)·하드웨어(trush.ino) 분류 체계에 맞춰
can → metal, general → glass 로 바꾼다 (plastic, paper 그대로).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1d9e0a7c001"
down_revision: Union[str, None] = "bbe2ecfec0d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RENAMES = (("can", "metal"), ("general", "glass"))


def upgrade() -> None:
    op.add_column("detection_logs", sa.Column("camera_id", sa.String(length=64), nullable=True))
    op.add_column("detection_logs", sa.Column("class_id", sa.Integer(), nullable=True))
    op.add_column("detection_logs", sa.Column("bounding_box", sa.JSON(), nullable=True))
    op.add_column("detection_logs", sa.Column("image_path", sa.Text(), nullable=True))
    op.add_column("detection_logs", sa.Column("hardware_status", sa.String(length=24), nullable=True))
    op.create_table(
        "edge_telemetry",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("sensor_id", sa.String(length=32), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("raw", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_edge_telemetry_device_id", "edge_telemetry", ["device_id"])
    op.create_index("ix_edge_telemetry_kind", "edge_telemetry", ["kind"])
    op.create_index("ix_edge_telemetry_measured_at", "edge_telemetry", ["measured_at"])
    for old, new in RENAMES:
        op.execute(f"UPDATE bins SET waste_type = '{new}' WHERE waste_type = '{old}'")
        op.execute(f"UPDATE detection_logs SET waste_type = '{new}' WHERE waste_type = '{old}'")
        op.execute(f"UPDATE device_commands SET target = '{new}' WHERE target = '{old}'")


def downgrade() -> None:
    for old, new in RENAMES:
        op.execute(f"UPDATE bins SET waste_type = '{old}' WHERE waste_type = '{new}'")
        op.execute(f"UPDATE detection_logs SET waste_type = '{old}' WHERE waste_type = '{new}'")
        op.execute(f"UPDATE device_commands SET target = '{old}' WHERE target = '{new}'")
    op.drop_index("ix_edge_telemetry_measured_at", table_name="edge_telemetry")
    op.drop_index("ix_edge_telemetry_kind", table_name="edge_telemetry")
    op.drop_index("ix_edge_telemetry_device_id", table_name="edge_telemetry")
    op.drop_table("edge_telemetry")
    for c in ("hardware_status", "image_path", "bounding_box", "class_id", "camera_id"):
        op.drop_column("detection_logs", c)
