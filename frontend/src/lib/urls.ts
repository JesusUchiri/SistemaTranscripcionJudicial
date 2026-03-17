/**
 * URLs base del API y WebSocket.
 * En local: se leen de .env.local (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_WS_URL); reiniciar dev si cambian.
 *
 * DOKPLOY / acceso desde otras PCs:
 * - En el servicio FRONTEND define en Build y Runtime:
 *   NEXT_PUBLIC_API_URL=https://TU-DOMINIO-BACKEND (ej. https://api.tudominio.com)
 *   NEXT_PUBLIC_WS_URL=wss://TU-DOMINIO-BACKEND (mismo host que API, protocolo wss)
 * - En el servicio BACKEND define:
 *   CORS_ORIGINS=https://TU-DOMINIO-FRONTEND (la URL desde la que abren la app)
 * Si frontend y backend comparten dominio (reverse proxy), el fallback usa el origen actual.
 */
function getApiBaseUrl(): string {
    const fromEnv = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    if (typeof window !== 'undefined' && fromEnv.includes('localhost') && !window.location.origin.includes('localhost')) {
        return window.location.origin
    }
    return fromEnv
}

function getWsBaseUrl(): string {
    const fromEnv = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'
    if (typeof window !== 'undefined' && fromEnv.includes('localhost') && !window.location.origin.includes('localhost')) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        return `${protocol}//${window.location.host}`
    }
    return fromEnv
}

/** URL base del API (sin barra final). Usar en cliente. */
export function apiBaseUrl(): string {
    return getApiBaseUrl()
}

/** URL base del WebSocket (sin barra final). Usar en cliente. */
export function wsBaseUrl(): string {
    return getWsBaseUrl()
}
