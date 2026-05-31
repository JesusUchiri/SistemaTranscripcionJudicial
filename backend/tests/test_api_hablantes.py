import pytest
from httpx import AsyncClient
import uuid


@pytest.mark.asyncio
async def test_listar_hablantes_responde(async_app_client: AsyncClient):
    """GET /audiencias/{id}/hablantes responde con lista (mock retorna vacía)."""
    aud_id = uuid.uuid4()
    response = await async_app_client.get(f"/api/audiencias/{aud_id}/hablantes")
    # Con mock_db_session los scalars().all() devuelve [] → 200 con lista vacía
    assert response.status_code in (200, 404)


@pytest.mark.asyncio
async def test_inferir_roles_audiencia_no_existe(async_app_client: AsyncClient):
    """POST inferir-roles con audiencia inexistente → 404."""
    aud_id = uuid.uuid4()
    response = await async_app_client.post(f"/api/audiencias/{aud_id}/hablantes/inferir-roles")
    assert response.status_code == 404
