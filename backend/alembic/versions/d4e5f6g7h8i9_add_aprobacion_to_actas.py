"""add aprobada fields to actas

Revision ID: d4e5f6g7h8i9
Revises: c9d4edbd238a
Create Date: 2026-03-16 21:05:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6g7h8i9'
down_revision: Union[str, None] = 'c9d4edbd238a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Agregar columnas aprobada_por y aprobada_at a tabla actas
    op.add_column('actas', sa.Column('aprobada_por', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('actas', sa.Column('aprobada_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key('fk_actas_aprobada_por_usuarios', 'actas', 'usuarios', ['aprobada_por'], ['id'])


def downgrade() -> None:
    # Eliminar constraint y columnas
    op.drop_constraint('fk_actas_aprobada_por_usuarios', 'actas', type_='foreignkey')
    op.drop_column('actas', 'aprobada_at')
    op.drop_column('actas', 'aprobada_por')
