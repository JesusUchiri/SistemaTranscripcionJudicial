import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database import get_db
from app.api.deps import get_current_user
from unittest.mock import AsyncMock, MagicMock
from app.models.usuario import Usuario
import uuid

# Un usuario simulado para las peticiones autenticadas
mock_user_id = uuid.uuid4()
mock_user = Usuario(
    id=mock_user_id,
    email="test@juzgado.gob.pe",
    nombre="Test User",
    password_hash="hashed_pwd_123",
    rol="supervisor",
    activo=True
)

async def override_get_current_user():
    return mock_user

@pytest.fixture
def mock_db_session():
    """Retorna una sesión asíncrona mockeada."""
    session = AsyncMock()
    # Para escalar query chains, e.g. session.execute(select(...))
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_result.scalars().all.return_value = []
    
    session.execute.return_value = mock_result
    return session

@pytest.fixture
def async_app_client(mock_db_session):
    """Retorna un cliente HTTP asíncrono para testear endpoints."""
    app.dependency_overrides[get_current_user] = override_get_current_user
    
    async def override_get_db():
        yield mock_db_session
        
    app.dependency_overrides[get_db] = override_get_db
    
    transport = ASGITransport(app=app)
    # create the client
    client = AsyncClient(transport=transport, base_url="http://testserver")
    yield client
    
    # teardown
    app.dependency_overrides.clear()
