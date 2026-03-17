# JudiScribe - Guía de Despliegue en Dokploy

**Estado**: ✅ Actualizado para producción
**Fecha**: 2026-03-17

---

## 🚨 Solución al Error 502 Bad Gateway

Si está viendo el error 502 Bad Gateway en `judiscribeapi.ecosdelseo.com`, esto significa que el backend no está respondiendo correctamente.

### Causas Comunes
1. ❌ El container del backend no inicia correctamente
2. ❌ Fallo en la conexión a la base de datos
3. ❌ Error en la función de seed automático
4. ❌ Timeout en conexión a BD

### ✅ Soluciones Aplicadas

He actualizado el código para:
1. **Retry automático con backoff** en conexión a BD
2. **Timeouts más altos** en producción (30s)
3. **Mejor logging** para diagnóstico
4. **Continúa sin seed** si la BD no responde (mejor que crashear)
5. **Pool de conexiones optimizado** para producción

---

## 📋 Variables de Entorno Requeridas

Asegúrate de que en Dokploy estén configuradas EXACTAMENTE así:

```env
# --- Base de datos ---
DATABASE_URL=postgresql+asyncpg://postgres:5eewwwv6avllprmd@judiscribe-base-de-datos-y6sd64:5432/postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=5eewwwv6avllprmd
POSTGRES_DB=postgres

# --- Redis ---
REDIS_URL=redis://default:pgavyzb9zn1xylr8@judiscribe-base-de-datos-qigub7:6379/0

# --- Deepgram ---
DEEPGRAM_API_KEY=1917e635526f0f450a6ed453baecc3de0b314199
DEEPGRAM_MODEL=nova-3

# --- Anthropic/Claude ---
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE  # Reemplaza con tu clave real
ANTHROPIC_MODEL=claude-3-5-haiku-20241022

# --- Hugging Face (opcional) ---
HF_TOKEN=sk_YOUR_HF_TOKEN  # Reemplaza con tu token real

# --- JWT ---
JWT_SECRET_KEY=6549286318c3fd9415ef5d42b03f82725efab000c574842151493dd1fa41b4dc
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# --- Audio Storage ---
AUDIO_STORAGE_PATH=/app/audio_files
AUDIO_ENCRYPTION_KEY=change_this_to_a_32_byte_hex_key
AUDIO_RETENTION_DAYS=30

# --- General ---
ENVIRONMENT=production
CORS_ORIGINS=https://judiscribe.ecosdelseo.com,https://www.judiscribe.ecosdelseo.com
BACKEND_URL=https://judiscribeapi.ecosdelseo.com
```

### ⚠️ IMPORTANTE
- **No copiar la DATABASE_URL sin revisar** los nombres de host (pueden cambiar en Dokploy)
- **Redis debe estar en el mismo aplicativo** o accesible desde la red
- **JWT_SECRET_KEY debe ser diferente en cada despliegue** (generar uno nuevo si es necesario)

---

## 🔧 Pasos para Desplegar

### 1. **Verificar la Conexión a BD**

Antes de desplegar, asegúrate que:
- ✅ PostgreSQL está levantado en Dokploy
- ✅ Redis está levantado
- ✅ Las credenciales en `.env` son correctas
- ✅ El nombre de host es accesible desde el contenedor del backend

### 2. **Verificar Logs**

En Dokploy, ve a **Logs** del servicio backend y busca:

```
✅ Éxito esperado:
🚀 JudiScribe backend starting...
✅ Base de datos ya poblada (2 usuarios)
✅ Database engine creado en modo PRODUCCIÓN
Uvicorn running on http://0.0.0.0:8000

❌ Problemas a buscar:
❌ Error en seed automático
Connection refused
Timeout waiting for database
```

### 3. **Si sigue fallando el 502**

1. **Espera 30 segundos** - A veces el container tarda en inicializar
2. **Revisa los logs** - Busca el error específico
3. **Reinicia el servicio** - En Dokploy: "Restart Service"
4. **Verifica la BD** - ¿Está PostgreSQL levantado? ¿Redis?
5. **Prueba con curl**:
   ```bash
   curl https://judiscribeapi.ecosdelseo.com/api/health
   ```
   Debería devolver:
   ```json
   {"status": "ok", "service": "judiscribe-backend", "version": "0.1.0"}
   ```

---

## 🏥 Healthcheck

El endpoint `/api/health` siempre responde, incluso si la BD no está disponible:

```bash
curl https://judiscribeapi.ecosdelseo.com/api/health
# Respuesta:
# {"status":"ok","service":"judiscribe-backend","version":"0.1.0"}
```

Esto permite verificar que el backend está respondiendo sin necesidad de base de datos.

---

## 📦 Estructura en Producción

```
Dokploy Application: judiscribe
├── Backend Service (FastAPI)
│   ├── Build: Dockerfile
│   ├── Port: 8000 (interno)
│   ├── Environment: .env
│   └── Domains: judiscribeapi.ecosdelseo.com
│
├── Frontend Service (Next.js)
│   ├── Build: frontend/Dockerfile
│   ├── Port: 3000 (interno)
│   └── Domains: judiscribe.ecosdelseo.com
│
└── Databases
    ├── PostgreSQL: judiscribe-base-de-datos-y6sd64 (puerto 5432)
    └── Redis: judiscribe-base-de-datos-qigub7 (puerto 6379)
```

---

## 🔐 Seguridad

- ✅ **CORS configurado** para solo https://judiscribe.ecosdelseo.com
- ✅ **JWT_SECRET_KEY debe ser fuerte** en producción
- ✅ **Credenciales en variables de entorno**, no en código
- ✅ **Logs no muestran contraseñas** en ENVIRONMENT=production

---

## 📊 Monitoreo

### Métricas a vigilar:
- ✅ Logs de errores de conexión a BD
- ✅ Timeouts en Deepgram API
- ✅ Fallos en generación de actas (Claude API)
- ✅ Uso de disco en `/app/audio_files`

### Alertas recomendadas:
- 🔴 Backend respondiendo 502 por más de 5 minutos
- 🔴 BD respondiendo lento (> 30s timeout)
- 🔴 Redis no disponible

---

## 🆘 Troubleshooting

### "Error 502: Bad Gateway"
```
Solución:
1. Revisa logs del backend en Dokploy
2. Verifica que PostgreSQL está UP
3. Verifica que REDIS_URL es correcto
4. Espera 30s y recarga
```

### "Connection refused to database"
```
Solución:
1. Verifica DATABASE_URL en .env
2. Verifica que PostgreSQL está levantado
3. Verifica las credenciales (usuario/contraseña)
```

### "Redis connection failed"
```
Solución:
1. Verifica REDIS_URL en .env
2. Verifica que Redis está levantado
3. Verifica contraseña de Redis
```

### "Timeout waiting for database"
```
Solución:
1. El backend reiniciará automáticamente (hasta 3 intentos)
2. Verifica si la BD está bajo mucha carga
3. Considera aumentar pool_size en database.py
```

---

## 📝 Cambios Recientes

**2026-03-17** - Fix para 502 Bad Gateway:
- ✅ Retry automático en conexión a BD
- ✅ Timeouts mejorados para producción
- ✅ Mejor logging de errores
- ✅ El backend continúa incluso sin BD inicial

---

## ✅ Checklist Antes de Desplegar

- [ ] DATABASE_URL actualizado y probado
- [ ] REDIS_URL actualizado y probado
- [ ] DEEPGRAM_API_KEY válida
- [ ] ANTHROPIC_API_KEY válida
- [ ] CORS_ORIGINS incluye el dominio del frontend
- [ ] JWT_SECRET_KEY es fuerte y único
- [ ] ENVIRONMENT=production
- [ ] Logs no muestran errores de startup
- [ ] `/api/health` responde correctamente
- [ ] Frontend puede conectarse al backend

---

**Soporte**: Si los problemas persisten, revisa los logs en Dokploy y abre un issue con el mensaje de error exacto.

