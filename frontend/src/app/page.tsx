'use client'

/**
 * Página principal — Dashboard protegido con autenticación.
 * Lista audiencias y permite crear/acceder al Canvas.
 *
 * UI Minimalista: sin emojis, tipografía como jerarquía.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import type { Audiencia } from '@/types'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'

const ESTADO_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    pendiente: { bg: 'rgba(113, 128, 150, 0.1)', text: '#718096', label: 'Pendiente' },
    en_curso: { bg: 'rgba(37, 99, 235, 0.1)', text: '#2563EB', label: 'En curso' },
    transcrita: { bg: 'rgba(217, 119, 6, 0.1)', text: '#D97706', label: 'Transcrita' },
    en_revision: { bg: 'rgba(234, 88, 12, 0.1)', text: '#EA580C', label: 'En revisión' },
    finalizada: { bg: 'rgba(5, 150, 105, 0.1)', text: '#059669', label: 'Finalizada' },
}

export default function DashboardPage() {
    const router = useRouter()
    const { user, logout } = useAuthStore()
    const [audiencias, setAudiencias] = useState<Audiencia[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (user?.rol === 'admin') {
            router.replace('/admin')
            return
        }
        fetchAudiencias()
    }, [user, router])

    // Refrescar lista al volver a la pestaña (p. ej. después de grabar)
    useEffect(() => {
        const onFocus = () => fetchAudiencias()
        const onVisibility = () => {
            if (document.visibilityState === 'visible') onFocus()
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            window.removeEventListener('focus', onFocus)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [])

    const fetchAudiencias = async () => {
        try {
            const { data } = await api.get('/api/audiencias')
            setAudiencias(data.items || [])
        } catch (err) {
            console.error('Error fetching audiencias:', err)
            setAudiencias([])
        } finally {
            setLoading(false)
        }
    }

    // Stats
    const hoy = new Date().toISOString().split('T')[0]
    const audienciasHoy = audiencias.filter((a) => a.fecha === hoy).length
    const pendientes = audiencias.filter((a) => a.estado === 'pendiente' || a.estado === 'en_curso').length
    const enRevision = audiencias.filter((a) => a.estado === 'en_revision').length

    const handleLogout = () => {
        logout()
        window.location.href = '/login'
    }

    return (
        <AuthGuard>
            <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
                {/* Header */}
                <header className="px-4 sm:px-8 py-4 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-4"
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
                    <div className="flex items-center gap-4">
                        <div className="logo-monogram shrink-0">J</div>
                        <div>
                            <h1 className="text-lg sm:text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                                JudiScribe
                            </h1>
                            <p className="text-xs sm:text-sm" style={{ color: 'var(--text-muted)' }}>Sistema de Transcripción Judicial</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-right hidden sm:block">
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{user?.nombre}</p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{user?.rol}</p>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                            {user?.rol === 'admin' && (
                                <button
                                    onClick={() => window.location.href = '/admin'}
                                    className="btn-primary"
                                    style={{ background: 'var(--accent-primary)', color: 'white' }}>
                                    Panel Admin
                                </button>
                            )}
                            <button
                                onClick={() => window.location.href = '/transcribir'}
                                className="btn-secondary flex-1 sm:flex-initial">
                                Subir audio
                            </button>
                            <button
                                onClick={() => window.location.href = '/audiencia/demo'}
                                className="btn-primary flex-1 sm:flex-initial">
                                Iniciar
                            </button>
                            <button
                                onClick={handleLogout}
                                className="btn-secondary flex-1 sm:flex-initial">
                                Salir
                            </button>
                        </div>
                    </div>
                </header>

                <main className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
                    {/* Stats - Números grandes minimalistas */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-10">
                        {[
                            { label: 'Hoy', value: audienciasHoy },
                            { label: 'Pendientes', value: pendientes },
                            { label: 'En revisión', value: enRevision },
                        ].map((stat) => (
                            <div key={stat.label} className="stat-card animate-fade-in">
                                <span className="stat-card__value">{stat.value}</span>
                                <span className="stat-card__label">{stat.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Sesiones de grabación */}
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-base sm:text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                            Sesiones de grabación
                        </h2>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => fetchAudiencias()}
                                className="btn-secondary text-xs sm:text-sm">
                                Actualizar
                            </button>
                            <button
                                onClick={() => window.location.href = '/audiencia/nueva'}
                                className="btn-secondary">
                                <span style={{ fontSize: '16px', fontWeight: 300 }}>+</span>
                                Nueva sesión
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-16 rounded-xl skeleton-shimmer" />
                            ))}
                        </div>
                    ) : audiencias.length === 0 ? (
                        <div className="rounded-2xl p-8 sm:p-16 text-center"
                            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                            <p className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Aún no tienes sesiones de grabación</p>
                            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Crea una nueva sesión para grabar y transcribir.</p>
                            <button
                                onClick={() => window.location.href = '/audiencia/nueva'}
                                className="btn-primary">
                                Nueva sesión de grabación
                            </button>
                        </div>
                    ) : (
                        <div className="rounded-2xl overflow-x-auto overflow-y-hidden"
                            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                            <table className="w-full text-sm min-w-[600px]">
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                                        {['Expediente', 'Tipo', 'Juzgado', 'Fecha', 'Creada', 'Estado', ''].map((h) => (
                                            <th key={h} className="text-left px-5 py-3.5 text-xs font-medium uppercase tracking-wider"
                                                style={{ color: 'var(--text-muted)' }}>
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {audiencias.map((a) => {
                                        const estado = ESTADO_COLORS[a.estado] || ESTADO_COLORS.pendiente
                                        const creada = a.created_at
                                            ? new Date(a.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
                                            : '—'
                                        return (
                                            <tr key={a.id}
                                                className="cursor-pointer transition-colors hover:bg-black/5"
                                                style={{ borderBottom: '1px solid var(--border-subtle)' }}
                                                onClick={() => window.location.href = `/audiencia/${a.id}`}>
                                                <td className="px-5 py-4 font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {a.expediente}
                                                </td>
                                                <td className="px-5 py-4" style={{ color: 'var(--text-secondary)' }}>
                                                    {a.tipo_audiencia}
                                                </td>
                                                <td className="px-5 py-4 max-w-[200px] truncate" style={{ color: 'var(--text-secondary)' }}>
                                                    {a.juzgado}
                                                </td>
                                                <td className="px-5 py-4" style={{ color: 'var(--text-secondary)' }}>{a.fecha}</td>
                                                <td className="px-5 py-4 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                                                    {creada}
                                                </td>
                                                <td className="px-5 py-4">
                                                    <span className="px-2.5 py-1 rounded-full text-xs font-medium"
                                                        style={{ background: estado.bg, color: estado.text }}>
                                                        {estado.label}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </main>
            </div>
        </AuthGuard>
    )
}
