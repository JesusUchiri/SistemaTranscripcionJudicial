import pytest
from httpx import AsyncClient
import uuid

@pytest.fixture
def test_audiencia_id():
    return str(uuid.uuid4())

@pytest.mark.asyncio
async def test_create_audiencia(async_app_client: AsyncClient, mocker):
    """Test para creación de audiencia por parte de un usuario."""
    # Ensure correct returning value using fake db refresh
    from datetime import datetime
    import uuid
    from app.main import app
    from app.database import get_db
    mock_db_session = app.dependency_overrides[get_db]()
    
    # We must await the generator if it's a fixture yielding a session
    import inspect
    if inspect.isasyncgen(mock_db_session):
        mock_db_session = await anext(mock_db_session)

    async def fake_refresh(instance):
        instance.id = uuid.uuid4()
        instance.estado = "pendiente"
        instance.created_at = datetime.now()
        instance.updated_at = datetime.now()
        
    mock_db_session.refresh.side_effect = fake_refresh

    response = await async_app_client.post(
        "/api/audiencias",
        json={
            "expediente": "1024-2026-PE",
            "juzgado": "Segundo Juzgado de Paz Letrado",
            "tipo_audiencia": "Control de Identidad",
            "instancia": "Juzgado de Paz",
            "fecha": "2026-03-16",
            "hora_inicio": "10:00:00"
        }
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["expediente"] == "1024-2026-PE"
    assert data["juzgado"] == "Segundo Juzgado de Paz Letrado"
    assert data["estado"] == "pendiente"

@pytest.mark.asyncio
async def test_get_audiencias(async_app_client: AsyncClient):
    """Obtención de lista de audiencias (Sprint 2)."""
    response = await async_app_client.get("/api/audiencias")
    assert response.status_code == 200
    data = response.json()
    # It returns a dictionary: {"items": [], "total": 0} due to AudienciaListResponse
    assert "items" in data
    assert len(data["items"]) == 0
