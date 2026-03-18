
import asyncio
from sqlalchemy import select
from app.database import engine, async_session
from app.models.usuario import Usuario

async def check_users():
    async with async_session() as db:
        result = await db.execute(select(Usuario))
        users = result.scalars().all()
        print(f"--- USUARIOS ENCONTRADOS: {len(users)} ---")
        for u in users:
            print(f"ID: {u.id} | Email: {u.email} | Rol: {u.rol} | Activo: {u.activo}")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(check_users())
