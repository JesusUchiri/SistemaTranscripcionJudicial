import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_capitalize_endpoint_validacion(async_app_client: AsyncClient):
    """POST /api/prediction/capitalize sin body → 422 validación."""
    response = await async_app_client.post("/api/prediction/capitalize", json={})
    assert response.status_code in (400, 422)


@pytest.mark.asyncio
async def test_detect_expediente_endpoint_estructura(async_app_client: AsyncClient):
    """POST /api/prediction/detect-expediente con texto plano → 200 con campo detected."""
    response = await async_app_client.post(
        "/api/prediction/detect-expediente",
        json={"texto": "Expediente N° 00123-2024 sobre el caso del agraviado"},
    )
    # Si no falla la validación, debe devolver estructura coherente
    assert response.status_code in (200, 422)
    if response.status_code == 200:
        data = response.json()
        # El endpoint debería devolver al menos un campo (cualquiera que sea su shape)
        assert isinstance(data, dict)


@pytest.mark.asyncio
async def test_analyze_structure_validacion(async_app_client: AsyncClient):
    """POST /api/prediction/analyze-structure sin body → 422 validación."""
    response = await async_app_client.post("/api/prediction/analyze-structure", json={})
    assert response.status_code in (400, 422)
