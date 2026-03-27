"""
JudiScribe — Configuración central con pydantic-settings.
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # ── Database ─────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://judiscribe:judiscribe_secret@localhost:5432/judiscribe"

    # ── Redis ────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Deepgram ─────────────────────────────────────────
    DEEPGRAM_API_KEY: str = ""
    DEEPGRAM_MODEL: str = "nova-3"

    # ── Anthropic ────────────────────────────────────────
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-3-haiku-20240307"  # Haiku para pruebas (más barato)

    # ── HuggingFace ──────────────────────────────────────
    HF_TOKEN: str = ""

    # ── JWT ──────────────────────────────────────────────
    JWT_SECRET_KEY: str = "change_me_in_production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 horas — suficiente para una jornada judicial
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Audio ────────────────────────────────────────────
    # Ruta donde se guardan los WAV de cada audiencia. En producción montar un volumen
    # persistente (ej. Docker volume o bind mount) para no perder audios al reiniciar.
    AUDIO_STORAGE_PATH: str = "/app/audio_files"
    AUDIO_ENCRYPTION_KEY: str = ""
    AUDIO_RETENTION_DAYS: int = 30

    # ── General ──────────────────────────────────────────
    # Dokploy: CORS_ORIGINS = URL del frontend (ej. https://app.tudominio.com).
    # Varios orígenes separados por coma: "https://app.com,https://www.app.com"
    ENVIRONMENT: str = "development"
    CORS_ORIGINS: str = "http://localhost:3000"

    model_config = {
        "env_file": [".env", ".env.local"],  # .env.local tiene prioridad (overrides locales)
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
        "extra": "ignore",
    }

    @property
    def cors_origins_list(self) -> list[str]:
        origins = [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
        if self.ENVIRONMENT == "development":
            for origin in ("http://localhost:3000", "http://127.0.0.1:3000"):
                if origin not in origins:
                    origins.append(origin)
        return origins


settings = Settings()
