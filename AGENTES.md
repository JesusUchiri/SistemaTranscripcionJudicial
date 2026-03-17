# JudiScribe — Contexto del Proyecto

## Qué es
Sistema web de transcripción judicial en tiempo real para el Distrito Judicial de Cusco, Perú.
Audio → Deepgram Nova-3 → Canvas TipTap → Edición → Generación de Acta con Claude Sonnet 4.

## Stack
- **Backend**: FastAPI 0.115+, SQLAlchemy async + asyncpg, PostgreSQL 16, Redis 7, Celery, Alembic
- **Frontend**: Next.js 14, React 18, TypeScript, TipTap (ProseMirror), Zustand, Tailwind CSS, wavesurfer.js
- **IA**: Deepgram Nova-3 (streaming + pre-recorded batch), Claude Sonnet 4 (actas), python-docx (DOCX), weasyprint (PDF)
- **Infra**: Docker Compose (6 servicios), nginx reverse proxy

## Estado General
- ✅ **Nivel 1 (MVP - Sprints 1-5)**: Completamente implementado
- ✅ **Nivel 2 (Extensión - Sprints 6-10)**: Completamente implementado
- ⏳ **Nivel 3 (Cierre - Sprints 11-15)**: Pendiente (mejoras UI/UX, corpus, capacitación)

## Comandos clave
```bash
# Levantar todo
cd judiscribe/backend && docker compose up -d

# Logs
docker compose logs -f backend
docker compose logs -f frontend

# Migraciones
docker compose exec backend alembic upgrade head
docker compose exec backend alembic revision --autogenerate -m "descripcion"

# Shell backend
docker compose exec backend python

# Reiniciar servicio individual
docker compose restart backend
docker compose restart frontend
```

## Estructura del proyecto
```
judiscribe/
├── backend/
│   ├── docker-compose.yml    # Orquestador principal
│   ├── .env                  # Variables (NO subir a git)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic/              # Migraciones DB
│   └── app/
│       ├── main.py           # FastAPI app
│       ├── config.py         # Pydantic Settings
│       ├── database.py       # SQLAlchemy async
│       ├── api/              # REST endpoints
│       ├── ws/               # WebSocket handlers
│       ├── models/           # ORM (audiencia, segmento, usuario, hablante, marcador, frase_estandar)
│       ├── schemas/          # Pydantic request/response
│       ├── services/         # Lógica de negocio (deepgram_streaming, auth_service)
│       └── tasks/            # Celery (batch_process, generate_acta)
└── frontend/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── app/              # Next.js pages (dashboard, login, audiencia/[id], audiencia/nueva)
        ├── components/       # Canvas, panels, audio, speakers, markers, shortcuts
        ├── hooks/            # useDeepgramSocket, useAudioCapture
        ├── stores/           # Zustand (authStore, canvasStore)
        ├── extensions/       # TipTap: SpeakerNode, BookmarkNode, LowConfidenceMark, SegmentMark
        ├── lib/              # api.ts (axios)
        └── types/            # TypeScript interfaces
```

## Reglas absolutas
1. **No sobreescribir ediciones**: Si `editado_por_usuario=true`, ningún proceso automático toca ese segmento
2. **LLM no inventa**: Si hay vacíos → `[SEGMENTO INAUDIBLE]`
3. **Todo vinculado a audio**: Cada segmento tiene `timestamp_inicio`/`timestamp_fin`
4. **Digitador tiene control**: Cualquier propuesta automática se puede rechazar
5. **Privacidad**: Solo texto va a Claude, nunca audio

## Convenciones de código
- Backend: Python 3.11, type hints, async/await, f-strings
- Frontend: TypeScript estricto, componentes funcionales con hooks, "use client" para interactividad
- Nombres en español para entidades del dominio (audiencia, segmento, hablante, marcador)
- Nombres de variables del dominio en español, nombres técnicos en inglés
- Mensajes de commit: `tipo: descripción` (feat, fix, chore, docs)

## Skills Disponibles (Integrados desde https://skills.sh/)

**Ubicación**: `.claude/skills/`

### Backend & AI
1. **architecture-patterns** - Patrones probados (Clean, Hexagonal, DDD)
2. **python-performance-optimization** - Profiling, optimización de código
3. **claude-api** ⭐ - Claude API + SDK Anthropic (para acta generation)

### Frontend
4. **react-patterns** - React 19, Server Components, Suspense
5. **nextjs-app-router-patterns** - Next.js 14+ App Router
6. **tailwind-css-patterns** - CSS utilities, responsive design
7. **shadcn-ui** - Componentes UI + validación con React Hook Form
8. **frontend-design** - Interfaz UI/UX de alta calidad
9. **interface-design** - Dashboards, paneles interactivos

### Cross-cutting
10. **accessibility-compliance** - WCAG 2.2, ARIA, screen readers
11. **design-system-patterns** - Tokens de diseño, theming

### Usar Skills
- Ubicación: `.claude/skills/[nombre]/SKILL.md`
- Cada skill tiene documentación por lenguaje (Python, TypeScript, etc.)
- **Sprint 5**: Usar `claude-api` para implementar `acta_generator.py`

## Referencia completa
Ver `Readme.md` en la raíz del Proyecto Tesis para la especificación técnica completa (32 secciones).
