import pytest
import uuid
from httpx import AsyncClient
from app.models.usuario import Usuario
from app.services.auth_service import create_access_token

@pytest.mark.asyncio
async def test_update_user_role_success(client: AsyncClient, db_session):
    """Prueba el cambio de rol exitoso por un administrador."""
    
    # 1. Crear un admin y un usuario normal
    admin = Usuario(
        id=uuid.uuid4(),
        email="admin_test@judiscribe.pe",
        nombre="Admin Test",
        password_hash="fakehash",
        rol="admin",
        activo=True
    )
    user = Usuario(
        id=uuid.uuid4(),
        email="user_test@judiscribe.pe",
        nombre="User Test",
        password_hash="fakehash",
        rol="transcriptor",
        activo=True
    )
    db_session.add(admin)
    db_session.add(user)
    await db_session.commit()

    # 2. Generar token de admin
    admin_token = create_access_token(admin.id, admin.rol)
    
    # 3. Cambiar rol del usuario a supervisor
    response = await client.patch(
        f"/api/users/{user.id}/role",
        json={"rol": "supervisor"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["rol"] == "supervisor"

@pytest.mark.asyncio
async def test_update_user_role_unauthorized(client: AsyncClient, db_session):
    """Prueba que un usuario no admin no pueda cambiar roles."""
    
    user1 = Usuario(
        id=uuid.uuid4(),
        email="user1@judiscribe.pe",
        nombre="User 1",
        password_hash="fakehash",
        rol="transcriptor",
        activo=True
    )
    user2 = Usuario(
        id=uuid.uuid4(),
        email="user2@judiscribe.pe",
        nombre="User 2",
        password_hash="fakehash",
        rol="transcriptor",
        activo=True
    )
    db_session.add(user1)
    db_session.add(user2)
    await db_session.commit()

    user1_token = create_access_token(user1.id, user1.rol)
    
    response = await client.patch(
        f"/api/users/{user2.id}/role",
        json={"rol": "admin"},
        headers={"Authorization": f"Bearer {user1_token}"}
    )
    
    # El middleware de require_role("admin") debería fallar
    assert response.status_code == 403

@pytest.mark.asyncio
async def test_update_own_role_fail(client: AsyncClient, db_session):
    """Prueba que un admin no pueda cambiarse su propio rol (por seguridad)."""
    
    admin = Usuario(
        id=uuid.uuid4(),
        email="admin_self@judiscribe.pe",
        nombre="Admin Self",
        password_hash="fakehash",
        rol="admin",
        activo=True
    )
    db_session.add(admin)
    await db_session.commit()

    admin_token = create_access_token(admin.id, admin.rol)
    
    response = await client.patch(
        f"/api/users/{admin.id}/role",
        json={"rol": "transcriptor"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 400
    assert "No puedes cambiar tu propio rol" in response.json()["detail"]
