/**
 * Axios instance configured for JudiScribe API.
 * En cliente usa apiBaseUrl() para soportar acceso desde otras PCs (Dokploy).
 * En 401 intenta renovar el access token con el refresh (cookie httpOnly) y reintenta la petición.
 */
import axios, { type InternalAxiosRequestConfig } from 'axios'
import { apiBaseUrl } from '@/lib/urls'

const api = axios.create({
    baseURL: typeof window !== 'undefined' ? apiBaseUrl() : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'),
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true, // necesario para cookies (refresh_token) con CORS
})

let isRefreshing = false

// Request interceptor — baseURL en cliente (por si se hidrata después) y JWT
api.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
        config.baseURL = apiBaseUrl()
        const token = localStorage.getItem('access_token')
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
    }
    return config
})

// Response interceptor — 401: intentar refresh con cookie y reintentar; si falla, ir a login
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

        if (error.response?.status !== 401 || typeof window === 'undefined') {
            return Promise.reject(error)
        }
        // No reintentar si ya fue el refresh o si esta petición ya se reintentó
        if (originalRequest.url?.includes('/api/auth/refresh') || originalRequest._retry) {
            localStorage.removeItem('access_token')
            window.location.href = '/login'
            return Promise.reject(error)
        }

        if (!isRefreshing) {
            isRefreshing = true
            try {
                const { data } = await api.post<{ access_token: string }>('/api/auth/refresh', {})
                localStorage.setItem('access_token', data.access_token)
                originalRequest._retry = true
                originalRequest.headers.Authorization = `Bearer ${data.access_token}`
                return api(originalRequest)
            } catch {
                localStorage.removeItem('access_token')
                window.location.href = '/login'
                return Promise.reject(error)
            } finally {
                isRefreshing = false
            }
        }

        return Promise.reject(error)
    }
)

export default api
