"""add segmento unique orden and indices

Revision ID: e3f7a1b2c894
Revises: 7f4c8a42dccb
Create Date: 2026-03-26

Adds:
- UNIQUE constraint on (audiencia_id, orden) to prevent duplicate segment orders
- Index on (audiencia_id, timestamp_inicio) for audio-sync queries
"""
from alembic import op
import sqlalchemy as sa

revision = 'e3f7a1b2c894'
down_revision = '7f4c8a42dccb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Primero: limpiar duplicados existentes de (audiencia_id, orden) si los hay,
    # manteniendo solo el registro con ID más reciente (UUID más grande en string).
    op.execute("""
        DELETE FROM segmentos
        WHERE id NOT IN (
            SELECT DISTINCT ON (audiencia_id, orden)
                id
            FROM segmentos
            ORDER BY audiencia_id, orden, id DESC
        )
    """)

    # Unique constraint: cada audiencia puede tener solo un segmento por orden
    op.create_unique_constraint(
        'uq_segmentos_audiencia_orden',
        'segmentos',
        ['audiencia_id', 'orden'],
    )

    # Índice compuesto para consultas de sync audio-canvas (buscar segmento por tiempo)
    op.create_index(
        'ix_segmentos_audiencia_timestamp',
        'segmentos',
        ['audiencia_id', 'timestamp_inicio'],
    )


def downgrade() -> None:
    op.drop_index('ix_segmentos_audiencia_timestamp', table_name='segmentos')
    op.drop_constraint('uq_segmentos_audiencia_orden', 'segmentos', type_='unique')
