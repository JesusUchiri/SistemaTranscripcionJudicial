import pytest
from httpx import AsyncClient
from unittest.mock import patch, MagicMock

@pytest.mark.asyncio
async def test_google_login_success(async_app_client: AsyncClient):
    """Prueba el flujo de login con Google exitoso (mockeando la verificación de Google)."""
    
    mock_user_info = {
        "email": "test_google@judiscribe.pe",
        "name": "Google Test User",
        "sub": "google-oauth2|123456789"
    }

    # Mock de la verificación de token de Google
    with patch("app.services.auth_service.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = mock_user_info
        
        # Simular que el cliente ID está configurado
        with patch("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "fake-client-id"):
            response = await async_app_client.post(
                "/api/auth/google",
                json={"id_token": "valid-fake-token"}
            )
            
            assert response.status_code == 200
            data = response.json()
            assert "access_token" in data
            assert response.cookies.get("refresh_token") is not None

@pytest.mark.asyncio
async def test_google_login_invalid_token(async_app_client: AsyncClient):
    """Prueba el flujo de login con Google con un token inválido."""
    
    with patch("app.services.auth_service.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.side_effect = ValueError("Invalid token")
        
        with patch("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "fake-client-id"):
            response = await async_app_client.post(
                "/api/auth/google",
                json={"id_token": "invalid-token"}
            )
            
            assert response.status_code == 401
            assert response.json()["detail"] == "Autenticación de Google fallida o usuario inactivo"

@pytest.mark.asyncio
async def test_google_login_missing_client_id(async_app_client: AsyncClient):
    """Prueba el flujo de login con Google cuando falta la configuración del client id."""
    
    with patch("app.services.auth_service.settings.GOOGLE_CLIENT_ID", ""):
        response = await async_app_client.post(
            "/api/auth/google",
            json={"id_token": "any-token"}
        )
        
        assert response.status_code == 401
