'use client'

/**
 * AuthGuard — Protege rutas que requieren autenticación.
 * Redirige a /login si no hay usuario autenticado.
 */
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'

interface AuthGuardProps {
    children: React.ReactNode
    requiredRole?: 'admin' | 'transcriptor' | 'supervisor'
}

export function AuthGuard({ children, requiredRole }: AuthGuardProps) {
    const router = useRouter()
    const pathname = usePathname()
    const { user, token, isLoading, fetchUser } = useAuthStore()
    const [isReady, setIsReady] = useState(false)

    useEffect(() => {
        const verify = async () => {
            // 1. Si no hay token, fuera.
            if (!token) {
                router.push(`/login?redirect=${encodeURIComponent(pathname)}`)
                return
            }

            // 2. Si hay token pero no hay usuario, intentar cargarlo una vez más
            if (token && !user && !isLoading) {
                try {
                    await fetchUser()
                } catch (err) {
                    console.error('Error verificando sesión:', err)
                    router.push(`/login?redirect=${encodeURIComponent(pathname)}`)
                    return
                }
            }

            setIsReady(true)
        }
        verify()
    }, [token, user, isLoading, pathname, router, fetchUser])

    // 3. Mientras carga o verifica, mostrar splash screen
    if (isLoading || !isReady) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
                <div className="text-center">
                    <div className="logo-monogram mx-auto mb-4 animate-pulse" style={{ width: '48px', height: '48px', fontSize: '20px' }}>
                        J
                    </div>
                    <p className="text-xs uppercase tracking-widest opacity-50" style={{ color: 'var(--text-primary)' }}>
                        Verificando credenciales
                    </p>
                </div>
            </div>
        )
    }

    // 4. Si después de cargar no hay usuario (token inválido o logout), el efecto ya habrá redirigido
    if (!user) return <>{children}</>

    // 5. Verificar permisos de rol (Admin tiene pase total)
    if (requiredRole && user.rol !== requiredRole && user.rol !== 'admin') {
        router.replace('/')
        return null
    }

    return <>{children}</>
}
