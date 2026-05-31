import pytest
from httpx import AsyncClient
import uuid


@pytest.mark.asyncio
async def test_subir_audio_falta_archivo(async_app_client: AsyncClient):
    """POST subir sin archivo → 400/422 (validación)."""
    response = await async_app_client.post(
        "/api/transcripcion-audio/subir",
        data={"expediente": "001-2026", "juzgado": "Test"},
    )
    assert response.status_code in (400, 422)


@pytest.mark.asyncio
async def test_procesar_audiencia_no_existe(async_app_client: AsyncClient):
    """POST /api/transcripcion-audio/procesar con audiencia inexistente → 404."""
    aud_id = uuid.uuid4()
    response = await async_app_client.post(
        "/api/transcripcion-audio/procesar",
        json={
            "audiencia_id": str(aud_id),
            "regions": [],
            "filters": {"normalize": True, "removeSilence": False, "volume": 1.0},
        },
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_retranscribir_audiencia_no_existe(async_app_client: AsyncClient):
    """POST /api/transcripcion-audio/{id}/retranscribir con audiencia inexistente → 404."""
    aud_id = uuid.uuid4()
    response = await async_app_client.post(f"/api/transcripcion-audio/{aud_id}/retranscribir")
    assert response.status_code == 404
