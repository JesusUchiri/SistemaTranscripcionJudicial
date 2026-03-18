"""
Router central de la API — registra todos los sub-routers.
"""
from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.audiencias import router as audiencias_router
from app.api.hablantes import router as hablantes_router
from app.api.marcadores import router as marcadores_router
from app.api.frases import router as frases_router
from app.api.analysis import router as analysis_router
from app.api.prediction import router as prediction_router
from app.api.transcripcion_audio import router as transcripcion_audio_router
from app.api.actas import router as actas_router

router = APIRouter()

router.include_router(auth_router)
router.include_router(users_router)
router.include_router(audiencias_router)
router.include_router(hablantes_router)
router.include_router(marcadores_router)
router.include_router(frases_router)
router.include_router(analysis_router)
router.include_router(prediction_router)
router.include_router(transcripcion_audio_router)
router.include_router(actas_router)

