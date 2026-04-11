#!/bin/bash
# deploy.sh — Pull, build y redeploy JudiScribe en producción
set -e

cd /root/Judiscribe

echo "📥 Pulling latest changes..."
git pull origin main

echo "🔨 Building images..."
cd backend
docker compose build backend celery-worker frontend

echo "🔑 Configurando autenticación de postgres (trust para red Docker)..."
docker exec backend-postgres-1 bash -c "
cat > /var/lib/postgresql/data/pg_hba.conf << 'HBAEOF'
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
local   replication     all                                     trust
host    replication     all             127.0.0.1/32            trust
host    replication     all             ::1/128                 trust
host    all             all             172.18.0.0/16           trust
host    all             all             all                     scram-sha-256
HBAEOF
" 2>/dev/null && \
docker exec backend-postgres-1 psql -U postgres -c "SELECT pg_reload_conf();" > /dev/null 2>&1 && \
echo "   ✅ pg_hba.conf actualizado" || echo "   ⚠️  postgres no disponible aún"

echo "🚀 Desplegando contenedores..."
docker compose up -d --remove-orphans backend celery-worker frontend

echo "⏳ Esperando que el backend esté healthy..."
for i in $(seq 1 24); do
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/health 2>/dev/null || echo "000")
    if [ "$HTTP" = "200" ]; then
        echo "   ✅ Backend healthy (intento $i)"
        break
    fi
    if [ "$i" = "24" ]; then
        echo "   ❌ Backend no respondió en 2 min, revisando logs..."
        docker compose logs backend --tail=20
        exit 1
    fi
    sleep 5
done

echo "🔄 Reiniciando nginx (re-resolver IPs de contenedores)..."
docker compose restart nginx
sleep 2

echo ""
echo "✅ Deploy completo. Verificando..."
HTTP=$(curl -s -o /dev/null -w "%{http_code}" https://judiscribe.tech/api/health)
if [ "$HTTP" = "200" ]; then
    echo "✅ https://judiscribe.tech → OK"
    docker compose ps
else
    echo "❌ Health check falló: HTTP $HTTP"
    docker compose logs backend --tail=20
    exit 1
fi
