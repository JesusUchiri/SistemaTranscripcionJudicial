"""
JudiScribe — Punto de entrada FastAPI.
Configura CORS, routers REST, WebSocket, y eventos de startup/shutdown.
"""
import logging
from contextlib import asynccontextmanager
from typing import Callable, List, Optional

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, func

from app.api.router import router as api_router
from app.config import settings
from app.database import engine, async_session, Base
from app.models.frase_estandar import FraseEstandar
from app.models.audiencia import Audiencia
from app.models.usuario import Usuario
import uuid
from datetime import date, time
from app.services.auth_service import hash_password
from app.ws.transcription_ws import transcription_websocket

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
# Silenciar loggers muy verbosos
logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


# Frases estándar del sistema
FRASES_SISTEMA = [
    {"numero_atajo": 1, "codigo": "F01", "texto": "SE DEJA CONSTANCIA QUE LA PRESENTE AUDIENCIA SE DESARROLLA DE MANERA VIRTUAL, A TRAVÉS DE LA PLATAFORMA GOOGLE MEET.", "categoria": "identificación"},
    {"numero_atajo": 2, "codigo": "F02", "texto": "HACE USO DE LA PALABRA EL/LA REPRESENTANTE DEL MINISTERIO PÚBLICO.", "categoria": "desarrollo"},
    {"numero_atajo": 3, "codigo": "F03", "texto": "HACE USO DE LA PALABRA LA DEFENSA TÉCNICA DEL ACUSADO/A.", "categoria": "desarrollo"},
    {"numero_atajo": 4, "codigo": "F04", "texto": "SEGUIDAMENTE SE LE CONCEDE EL USO DE LA PALABRA AL ACUSADO/A PARA QUE EJERZA SU DERECHO DE AUTODEFENSA.", "categoria": "desarrollo"},
    {"numero_atajo": 5, "codigo": "F05", "texto": "SE DEJA CONSTANCIA QUE SE HA PROCEDIDO A ORALIZAR LA PRUEBA DOCUMENTAL.", "categoria": "desarrollo"},
    {"numero_atajo": 6, "codigo": "F06", "texto": "SE SUSPENDE LA AUDIENCIA PARA CONTINUARLA EL DÍA {FECHA} A LAS {HORA} HORAS.", "categoria": "cierre"},
    {"numero_atajo": 7, "codigo": "F07", "texto": "SE DA POR CONCLUIDA LA PRESENTE AUDIENCIA, FIRMANDO LOS QUE EN ELLA INTERVINIERON.", "categoria": "cierre"},
    {"numero_atajo": 8, "codigo": "F08", "texto": "QUEDA CONSENTIDA LA RESOLUCIÓN AL NO SER IMPUGNADA POR LAS PARTES.", "categoria": "cierre"},
    {"numero_atajo": 9, "codigo": "F09", "texto": "SE PROCEDE AL EXAMEN DEL TESTIGO/PERITO, PREVIA JURAMENTACIÓN DE LEY.", "categoria": "desarrollo"},
    {"numero_atajo": 0, "codigo": "F10", "texto": "SIENDO LAS {HORA} HORAS DEL DÍA {FECHA}, SE DA INICIO A LA PRESENTE AUDIENCIA.", "categoria": "identificación"},
]


async def auto_seed_database():
    """Puebla automáticamente la base de datos si está vacía. Manejo robusto de errores."""
    max_retries = 3
    retry_count = 0

    while retry_count < max_retries:
        try:
            logger.info(f"🔄 Intentando inicializar BD (intento {retry_count + 1}/{max_retries})...")

            # Crear tablas si no existen
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("✅ Tablas creadas/verificadas")

            async with async_session() as db:
                # Verificar si hay usuarios
                resultado = await db.execute(select(func.count(Usuario.id)))
                total_usuarios = resultado.scalar()

                if total_usuarios == 0:
                    logger.info("📦 Base de datos vacía. Iniciando seed automático...")

                    # Crear usuario admin
                    admin = Usuario(
                        email="admin@judiscribe.pe",
                        nombre="Administrador del Sistema",
                        password_hash=hash_password("JudiScribe2024!"),
                        rol="admin",
                        activo=True,
                    )
                    db.add(admin)
                    logger.info("   ✅ Usuario admin creado")

                    # Crear usuario digitador
                    digitador = Usuario(
                        email="digitador@judiscribe.pe",
                        nombre="Digitador de Audiencias",
                        password_hash=hash_password("Digitador2024!"),
                        rol="transcriptor",
                        activo=True,
                    )
                    db.add(digitador)
                    logger.info("   ✅ Usuario digitador creado")

                    # Crear frases estándar
                    for frase_data in FRASES_SISTEMA:
                        frase = FraseEstandar(**frase_data)
                        db.add(frase)
                    logger.info(f"   ✅ {len(FRASES_SISTEMA)} frases estándar creadas")

                    # Crear Audiencia Demo para pruebas de UI (transcribir/00000...)
                    
                    demo_audiencia = Audiencia(
                        id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
                        expediente="DEMO-00001",
                        juzgado="Juzgado Penal Test",
                        tipo_audiencia="Audiencia de Prueba",
                        instancia="Demo",
                        fecha=date.today(),
                        hora_inicio=time(9, 0),
                        created_by=digitador.id
                    )
                    db.add(demo_audiencia)

                    await db.commit()
                    logger.info("🎉 Seed automático completado. Sistema listo.")
                    logger.info("   📧 Login: digitador@judiscribe.pe / Digitador2024!")
                else:
                    logger.info(f"✅ Base de datos ya poblada ({total_usuarios} usuarios)")

                # Validar la existencia de la audiencia Demo (en caso que no este)
                resultado_demo = await db.execute(select(Audiencia).where(Audiencia.id == "00000000-0000-0000-0000-000000000000"))
                demo_existe = resultado_demo.scalar_one_or_none()
                if not demo_existe:
                    # fetch transcriptor to assign to, so the digitador can access the WS
                    res_user_fetch = await db.execute(select(Usuario).where(Usuario.rol == 'transcriptor').limit(1))
                    user_fetched = res_user_fetch.scalar_one_or_none()
                    if user_fetched:
                        demo_audiencia = Audiencia(
                            id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
                            expediente="DEMO-00001",
                            juzgado="Juzgado Penal Test",
                            tipo_audiencia="Audiencia de Prueba",
                            instancia="Demo",
                            fecha=date.today(),
                            hora_inicio=time(9, 0),
                            created_by=user_fetched.id
                        )
                        db.add(demo_audiencia)
                        await db.commit()
                        logger.info("   ✅ Audiencia DEMO conectada para pruebas.")

            return  # Éxito

        except Exception as e:
            retry_count += 1
            logger.error(f"⚠️ Error en seed automático (intento {retry_count}/{max_retries}): {type(e).__name__}: {e}")

            if retry_count >= max_retries:
                logger.warning(f"❌ No se pudo inicializar BD después de {max_retries} intentos. Continuando sin seed...")
                logger.warning("   ⚠️ El sistema puede no funcionar correctamente sin datos iniciales.")
                return

            # Esperar antes de reintentar
            import asyncio
            await asyncio.sleep(2 ** retry_count)  # Exponential backoff: 2s, 4s, 8s


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("🚀 JudiScribe backend starting...")
    logger.info(f"   Environment: {settings.ENVIRONMENT}")
    logger.info(f"   CORS origins: {settings.cors_origins_list}")

    # Validate critical config
    if not settings.DEEPGRAM_API_KEY or settings.DEEPGRAM_API_KEY == "":
        logger.error("❌ DEEPGRAM_API_KEY is not configured - WebSocket audio transcription will fail")
        logger.error("   Please set DEEPGRAM_API_KEY in environment variables")
    else:
        logger.info(f"✅ DEEPGRAM_API_KEY configured (length: {len(settings.DEEPGRAM_API_KEY)} chars)")
    logger.info(f"   DEEPGRAM_MODEL: {settings.DEEPGRAM_MODEL}")

    # Seed automático de la base de datos
    await auto_seed_database()

    yield
    logger.info("🛑 JudiScribe backend shutting down...")
    await engine.dispose()


app = FastAPI(
    title="JudiScribe API",
    description="Sistema de transcripción judicial en tiempo real para el Distrito Judicial de Cusco",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────
# Origen: primero middleware que inyecta CORS en TODAS las respuestas (también 500),
# luego CORSMiddleware estándar.
_cors_origins = settings.cors_origins_list


class InjectCORSHeadersMiddleware:
    """Añade Access-Control-Allow-Origin a toda respuesta HTTP para que el navegador no bloquee por CORS."""

    def __init__(self, app: ASGIApp, allowed_origins: List[str]) -> None:
        self.app = app
        self.allowed_origins = [o.rstrip("/") for o in allowed_origins] if allowed_origins else []

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        origin = None
        for key, value in scope.get("headers", []):
            if key == b"origin":
                origin = value.decode("utf-8").strip()
                break
        allow_origin = None
        if origin and origin.rstrip("/") in self.allowed_origins:
            allow_origin = origin
        elif self.allowed_origins:
            allow_origin = self.allowed_origins[0]

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start" and allow_origin:
                headers = list(message.get("headers", []))
                has_origin = any(h[0].lower() == b"access-control-allow-origin" for h in headers)
                if not has_origin:
                    headers.append((b"access-control-allow-origin", allow_origin.encode()))
                    headers.append((b"access-control-allow-credentials", b"true"))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cors)


# Primero CORSMiddleware (más interno), luego nuestro inyector (más externo) para que
# toda respuesta pase por él y lleve Access-Control-Allow-Origin aunque sea 500.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
app.add_middleware(InjectCORSHeadersMiddleware, allowed_origins=_cors_origins)


def _cors_headers(origin: Optional[str]) -> dict:
    """Cabeceras CORS para respuestas de error (el navegador las necesita siempre)."""
    if origin and origin.rstrip("/") in [o.rstrip("/") for o in _cors_origins]:
        return {"Access-Control-Allow-Origin": origin}
    if _cors_origins:
        return {"Access-Control-Allow-Origin": _cors_origins[0]}
    return {}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Asegura que las respuestas 500 incluyan cabeceras CORS para que el front no vea error CORS."""
    logger.exception("Error no controlado: %s", exc)
    origin = request.headers.get("origin")
    headers = _cors_headers(origin)
    return JSONResponse(
        status_code=500,
        content={"detail": "Error interno del servidor"},
        headers=headers,
    )


# ── REST routes ──────────────────────────────────────────
app.include_router(api_router)

# ── WebSocket routes ─────────────────────────────────────
app.websocket("/ws/transcripcion/{audiencia_id}")(transcription_websocket)


# ── Health check ─────────────────────────────────────────
@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "judiscribe-backend",
        "version": "0.1.0",
    }
