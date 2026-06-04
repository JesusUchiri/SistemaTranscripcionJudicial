"""add_aprobada_fields_to_actas

Revision ID: 793255fca25a
Revises: c9d4edbd238a
Create Date: 2026-03-18 17:45:16.880078
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '793255fca25a'
down_revision: Union[str, None] = 'c9d4edbd238a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'actas' not in tables:
        op.create_table(
            'actas',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('audiencia_id', sa.UUID(), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False),
            sa.Column('formato', sa.String(length=10), nullable=False),
            sa.Column('estado', sa.String(length=20), nullable=False),
            sa.Column('contenido_llm', sa.Text(), nullable=True),
            sa.Column('contenido_editado', sa.Text(), nullable=True),
            sa.Column('prompt_utilizado', sa.Text(), nullable=True),
            sa.Column('modelo_llm', sa.String(length=100), nullable=True),
            sa.Column('tokens_used', sa.Integer(), nullable=True),
            sa.Column('confianza', sa.Float(), nullable=True),
            sa.Column('generado_por', sa.UUID(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('aprobada_por', sa.UUID(), nullable=True),
            sa.Column('aprobada_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['audiencia_id'], ['audiencias.id']),
            sa.ForeignKeyConstraint(['generado_por'], ['usuarios.id']),
            sa.ForeignKeyConstraint(['aprobada_por'], ['usuarios.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        return

    columns = {column['name'] for column in inspector.get_columns('actas')}
    if 'aprobada_por' not in columns:
        op.add_column('actas', sa.Column('aprobada_por', sa.UUID(), nullable=True))
        op.create_foreign_key(
            'fk_actas_aprobada_por_usuarios',
            'actas',
            'usuarios',
            ['aprobada_por'],
            ['id'],
        )
    if 'aprobada_at' not in columns:
        op.add_column('actas', sa.Column('aprobada_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'actas' not in inspector.get_table_names():
        return

    columns = {column['name'] for column in inspector.get_columns('actas')}
    if 'aprobada_por' in columns:
        op.drop_constraint('fk_actas_aprobada_por_usuarios', 'actas', type_='foreignkey')
        op.drop_column('actas', 'aprobada_por')
    if 'aprobada_at' in columns:
        op.drop_column('actas', 'aprobada_at')
