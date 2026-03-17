import pytest
from httpx import AsyncClient
import uuid

@pytest.mark.asyncio
async def test_read_users_me(async_app_client: AsyncClient):
    """Prueba acceso a endpoint protegido (Sprint 1)."""
    response = await async_app_client.get("/api/auth/me")
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test@juzgado.gob.pe"
    assert data["nombre"] == "Test User"
    assert data["rol"] == "supervisor"

@pytest.mark.asyncio
async def test_login_wrong_credentials(async_app_client: AsyncClient):
    """Prueba intento de login con datos erróneos (Sprint 1)."""
    # Requires overriding the actual authenticate_user logic, but using raw endpoint
    response = await async_app_client.post(
        "/api/auth/login", 
        json={"email": "fake@juzgado.pe", "password": "wrong"}
    )
    # The actual db mock won't find the user, so it should return 401
    assert response.status_code == 401
    assert "Credenciales incorrectas" in response.json().get("detail", "")
