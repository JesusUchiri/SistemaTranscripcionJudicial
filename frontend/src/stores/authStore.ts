/**
 * Auth store — manages JWT token and current user state.
 */
import { create } from 'zustand'
import api from '@/lib/api'
import type { User, LoginRequest, TokenResponse } from '@/types'

interface AuthState {
    user: User | null
    token: string | null
    isLoading: boolean
    error: string | null

    login: (credentials: LoginRequest) => Promise<boolean>
    googleLogin: (idToken: string) => Promise<boolean>
    logout: () => Promise<void>
    fetchUser: () => Promise<void>
    initialize: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
    user: null,
    token: typeof window !== 'undefined' ? localStorage.getItem('access_token') : null,
    isLoading: false,
    error: null,

    login: async (credentials) => {
        // LIMPIEZA TOTAL ANTES DE INTENTAR LOGIN
        localStorage.removeItem('access_token')
        set({ user: null, token: null, isLoading: true, error: null })
        
        try {
            const { data } = await api.post<TokenResponse>('/api/auth/login', credentials)
            localStorage.setItem('access_token', data.access_token)
            
            // Forzar el token en el estado inmediatamente
            set({ token: data.access_token })
            
            // CARGAR EL USUARIO ANTES DE TERMINAR EL LOGIN
            const userRes = await api.get<User>('/api/auth/me')
            set({ user: userRes.data, isLoading: false })
            
            return true
        } catch (err: any) {
            const isNetworkError = !err.response && (err.code === 'ERR_NETWORK' || err.message?.includes('Network'))
            const detail = err.response?.data?.detail || ''
            const is503 = err.response?.status === 503
            const message = isNetworkError
                ? 'No se puede conectar al servidor. Comprueba que el backend esté en marcha (puerto 8000).'
                : is503
                    ? 'Base de datos no disponible. Abre el túnel SSH: ejecuta backend\\abrir-tunel.bat, introduce la contraseña y deja la ventana abierta.'
                    : (detail || 'Error al iniciar sesión')
            set({ isLoading: false, error: message })
            return false
        }
    },

    googleLogin: async (idToken) => {
        localStorage.removeItem('access_token')
        set({ user: null, token: null, isLoading: true, error: null })
        
        try {
            const { data } = await api.post<TokenResponse>('/api/auth/google', { id_token: idToken })
            localStorage.setItem('access_token', data.access_token)
            set({ token: data.access_token })
            
            const userRes = await api.get<User>('/api/auth/me')
            set({ user: userRes.data, isLoading: false })
            
            return true
        } catch (err: any) {
            set({ isLoading: false, error: err.response?.data?.detail || 'Error en autenticación con Google' })
            return false
        }
    },

    logout: async () => {
        localStorage.removeItem('access_token')
        set({ user: null, token: null })
        try {
            await api.post('/api/auth/logout')
        } catch {
            // Ignorar
        }
    },

    fetchUser: async () => {
        set({ isLoading: true })
        try {
            const { data } = await api.get<User>('/api/auth/me')
            set({ user: data, isLoading: false })
        } catch {
            set({ user: null, token: null, isLoading: false })
            localStorage.removeItem('access_token')
        }
    },

    initialize: async () => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
        if (token) {
            set({ token })
            await get().fetchUser()
        }
    },
}))
