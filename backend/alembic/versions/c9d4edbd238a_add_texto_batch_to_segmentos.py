"""add texto_batch to segmentos

Revision ID: c9d4edbd238a
Revises: b8c3f2e9d1a0
Create Date: 2026-03-16 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d4edbd238a'
down_revision: Union[str, None] = 'b8c3f2e9d1a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Agregar columna texto_batch a segmentos para Sprint 7
    op.add_column('segmentos', sa.Column('texto_batch', sa.Text(), nullable=True))


def downgrade() -> None:
    # Eliminar columna texto_batch
    op.drop_column('segmentos', 'texto_batch')
