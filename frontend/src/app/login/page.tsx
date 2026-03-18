'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { login, isLoading, error, user } = useAuthStore()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    // Redirigir si ya está autenticado
    useEffect(() => {
        if (user) {
            if (user.rol === 'admin') {
                router.replace('/admin')
            } else {
                const redirect = searchParams.get('redirect') || '/'
                router.push(redirect)
            }
        }
    }, [user, router, searchParams])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const success = await login({ email, password })
        if (success) {
            // El store ya cargó al usuario antes de devolver success: true
            const userState = useAuthStore.getState()
            const currentUser = userState.user
            
            if (currentUser?.rol === 'admin') {
                router.replace('/admin')
            } else {
                const redirect = searchParams.get('redirect') || '/'
                router.push(redirect)
            }
        }
    }

    const usarCredencialesDemo = (tipo: 'digitador' | 'admin') => {
        if (tipo === 'digitador') {
            setEmail('digitador@judiscribe.pe')
            setPassword('Digitador2024!')
        } else {
            setEmail('admin@judiscribe.pe')
            setPassword('JudiScribe2024!')
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
            {/* Background texture */}
            <div
                className="absolute inset-0 opacity-[0.03]"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            />

            {/* Gradient orb */}
            <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full opacity-10"
                style={{ background: 'radial-gradient(circle, var(--accent-gold), transparent 70%)' }}
            />

            <div className="relative z-10 w-full max-w-md px-4 sm:px-6">
                {/* Logo / Brand */}
                <div className="text-center mb-6 sm:mb-10 animate-fade-in">
                    <div className="logo-monogram mx-auto mb-4 sm:mb-6" style={{ width: '52px', height: '52px', fontSize: '22px', borderRadius: '12px' }}>
                        J
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                        JudiScribe
                    </h1>
                    <p className="mt-2 text-xs sm:text-sm" style={{ color: 'var(--text-muted)' }}>
                        Transcripción Judicial Inteligente
                    </p>
                    <p className="text-[10px] sm:text-xs mt-1" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                        Corte Superior de Justicia del Cusco
                    </p>
                </div>

                {/* Login Card */}
                <div className="rounded-2xl p-6 sm:p-8 animate-fade-in"
                    style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.3)',
                        animationDelay: '0.1s',
                    }}>

                    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                        {/* Email */}
                        <div>
                            <label className="block text-[10px] sm:text-xs font-medium mb-1.5 sm:mb-2 uppercase tracking-wider"
                                style={{ color: 'var(--text-muted)' }}>
                                Correo electrónico
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                placeholder="digitador@pj.gob.pe"
                                className="w-full px-4 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm outline-none transition-all duration-200 focus:ring-2"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-default)',
                                    color: 'var(--text-primary)',
                                    caretColor: 'var(--accent-gold)',
                                }}
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-[10px] sm:text-xs font-medium mb-1.5 sm:mb-2 uppercase tracking-wider"
                                style={{ color: 'var(--text-muted)' }}>
                                Contraseña
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                placeholder="••••••••"
                                className="w-full px-4 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm outline-none transition-all duration-200 focus:ring-2"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-default)',
                                    color: 'var(--text-primary)',
                                    caretColor: 'var(--accent-gold)',
                                }}
                            />
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="px-4 py-3 rounded-xl text-sm flex items-center gap-2"
                                style={{ background: 'rgba(220, 38, 38, 0.08)', color: 'var(--danger)', border: '1px solid rgba(220, 38, 38, 0.2)' }}>
                                <span style={{ fontWeight: 600 }}>Error:</span> {error}
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="btn-primary w-full py-3.5 text-sm uppercase tracking-wide disabled:opacity-50">
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    Verificando...
                                </span>
                            ) : (
                                'Iniciar Sesión'
                            )}
                        </button>
                    </form>

                    {/* Divider */}
                    <div className="flex items-center gap-3 my-6">
                        <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Acceso rápido</span>
                        <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                    </div>

                    {/* Quick access buttons */}
                    <div className="space-y-3">
                        <button
                            type="button"
                            onClick={() => usarCredencialesDemo('digitador')}
                            className="w-full px-4 py-3 rounded-xl text-sm transition-all text-left"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-default)',
                                color: 'var(--text-primary)',
                            }}>
                            <div className="font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>Digitador de Prueba</div>
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>digitador@judiscribe.pe</div>
                        </button>
                        <button
                            type="button"
                            onClick={() => usarCredencialesDemo('admin')}
                            className="w-full px-4 py-3 rounded-xl text-sm transition-all text-left"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-default)',
                                color: 'var(--text-primary)',
                            }}>
                            <div className="font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>Administrador</div>
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>admin@judiscribe.pe</div>
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
                    Poder Judicial del Perú — Distrito Judicial de Cusco
                </p>
            </div>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
                <div className="text-center">
                    <div className="logo-monogram mx-auto mb-4 animate-pulse" style={{ width: '48px', height: '48px', fontSize: '20px' }}>
                        J
                    </div>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
                </div>
            </div>
        }>
            <LoginForm />
        </Suspense>
    )
}
