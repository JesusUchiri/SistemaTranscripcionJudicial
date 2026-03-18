'use client'

/**
 * Panel de Administración — Solo para administradores.
 * Permite gestionar usuarios y ver estadísticas de uso (conteo y costo).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'

interface UsuarioStats {
    id: string
    email: string
    nombre: string
    rol: string
    activo: boolean
    created_at: string
    transcripciones_count: number
    duracion_total_segundos: number
    costo_deepgram_usd: number
    costo_claude_usd: number
    costo_total_usd: number
}

export default function AdminDashboard() {
    const router = useRouter()
    const { logout, user, isLoading: authLoading } = useAuthStore()
    const [usuarios, setUsuarios] = useState<UsuarioStats[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // Solo cargar datos si el usuario ya está confirmado como admin
        if (user && user.rol === 'admin') {
            fetchUsuarios()
        }
    }, [user])

    const fetchUsuarios = async () => {
        try {
            setLoading(true)
            const { data } = await api.get('/api/users')
            setUsuarios(data.items || [])
            setError(null)
        } catch (err: any) {
            console.error('Error fetching users:', err)
            setError(err.response?.data?.detail || 'Error al cargar usuarios')
        } finally {
            setLoading(false)
        }
    }

    const handleToggleActive = async (userId: string) => {
        try {
            const { data } = await api.patch(`/api/users/${userId}/toggle-active`)
            setUsuarios(prev => prev.map(u => u.id === userId ? data : u))
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Error al cambiar estado')
        }
    }

    const handleDeleteUser = async (userId: string) => {
        if (!confirm('¿Estás seguro de eliminar este usuario? Esta acción no se puede deshacer.')) return
        try {
            await api.delete(`/api/users/${userId}`)
            setUsuarios(prev => prev.filter(u => u.id !== userId))
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Error al eliminar usuario')
        }
    }

    const handleLogout = () => {
        logout()
        window.location.href = '/login'
    }

    // Totales globales (excluir admins)
    const noAdmins = usuarios.filter(u => u.rol !== 'admin')
    const totalTranscripciones = noAdmins.reduce((acc, u) => acc + u.transcripciones_count, 0)
    const totalDeepgram = noAdmins.reduce((acc, u) => acc + u.costo_deepgram_usd, 0)
    const totalClaude = noAdmins.reduce((acc, u) => acc + u.costo_claude_usd, 0)
    const totalCosto = totalDeepgram + totalClaude
    const totalUsuarios = usuarios.length

    return (
        <AuthGuard requiredRole="admin">
            <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
                {/* Header Admin */}
                <header className="px-4 sm:px-8 py-4 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-4"
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
                    <div className="flex items-center gap-4">
                        <div className="logo-monogram shrink-0" style={{ background: 'var(--accent-primary)', color: 'white' }}>A</div>
                        <div>
                            <h1 className="text-lg sm:text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                                Panel de Control
                            </h1>
                            <p className="text-xs sm:text-sm" style={{ color: 'var(--text-muted)' }}>Administración de Usuarios y Recursos</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-right hidden sm:block">
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{user?.nombre}</p>
                            <p className="text-xs uppercase tracking-wider font-bold" style={{ color: 'var(--accent-primary)' }}>Administrador</p>
                        </div>
                        <button onClick={handleLogout} className="btn-secondary">
                            Cerrar Sesión
                        </button>
                    </div>
                </header>

                <main className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
                    {/* Stats de Uso Global */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mb-10">
                        {[
                            { label: 'Usuarios', value: totalUsuarios },
                            { label: 'Transcripciones', value: totalTranscripciones },
                            { label: 'Costo Deepgram', value: `$${totalDeepgram.toFixed(3)}`, sub: 'USD · streaming $0.0059/min' },
                            { label: 'Costo Claude', value: `$${totalClaude.toFixed(4)}`, sub: 'USD · tokens actas' },
                        ].map((stat) => (
                            <div key={stat.label} className="stat-card animate-fade-in" style={{ borderLeft: '4px solid var(--accent-primary)' }}>
                                <span className="stat-card__value text-2xl sm:text-3xl">{stat.value}</span>
                                <span className="stat-card__label text-xs uppercase tracking-widest">{stat.label}</span>
                                {stat.sub && <span className="text-[10px] opacity-50 block mt-1">{stat.sub}</span>}
                            </div>
                        ))}
                    </div>

                    {/* Tabla de Usuarios */}
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-base sm:text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                            Gestión de Usuarios
                        </h2>
                        <button
                            onClick={() => window.location.href = '/admin/nuevo-usuario'}
                            className="btn-primary">
                            + Nuevo Usuario
                        </button>
                    </div>

                    {error && (
                        <div className="p-4 mb-6 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="h-16 rounded-xl skeleton-shimmer" />
                            ))}
                        </div>
                    ) : usuarios.length === 0 ? (
                        <div className="rounded-2xl p-16 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                            <p style={{ color: 'var(--text-muted)' }}>No hay usuarios registrados.</p>
                        </div>
                    ) : (
                        <div className="rounded-2xl overflow-hidden border border-subtle" style={{ background: 'var(--bg-surface)' }}>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                                            <th className="px-6 py-4 font-medium" style={{ color: 'var(--text-muted)' }}>Usuario</th>
                                            <th className="px-6 py-4 font-medium" style={{ color: 'var(--text-muted)' }}>Rol</th>
                                            <th className="px-6 py-4 font-medium" style={{ color: 'var(--text-muted)' }}>Estado</th>
                                            <th className="px-6 py-4 font-medium text-center" style={{ color: 'var(--text-muted)' }}>Transcrip.</th>
                                            <th className="px-6 py-4 font-medium text-right hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>Deepgram</th>
                                            <th className="px-6 py-4 font-medium text-right hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>Claude</th>
                                            <th className="px-6 py-4 font-medium text-right" style={{ color: 'var(--text-muted)' }}>Total USD</th>
                                            <th className="px-6 py-4 font-medium text-right" style={{ color: 'var(--text-muted)' }}>Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-subtle">
                                        {usuarios.map((u) => (
                                            <tr key={u.id} className="hover:bg-black/5 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{u.nombre}</div>
                                                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{u.email}</div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                        u.rol === 'admin' ? 'bg-purple-100 text-purple-700' : 
                                                        u.rol === 'supervisor' ? 'bg-blue-100 text-blue-700' : 
                                                        'bg-gray-100 text-gray-700'
                                                    }`}>
                                                        {u.rol}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <button 
                                                        onClick={() => handleToggleActive(u.id)}
                                                        className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                                                            u.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                        }`}
                                                    >
                                                        {u.activo ? 'ACTIVO' : 'INACTIVO'}
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4 text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                                                    {u.rol === 'admin' ? <span style={{ color: 'var(--text-muted)' }}>—</span> : u.transcripciones_count}
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>
                                                    {u.rol === 'admin' ? '—' : `$${u.costo_deepgram_usd.toFixed(3)}`}
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>
                                                    {u.rol === 'admin' ? '—' : `$${u.costo_claude_usd.toFixed(4)}`}
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                                                    {u.rol === 'admin' ? <span style={{ color: 'var(--text-muted)' }}>—</span> : `$${u.costo_total_usd.toFixed(3)}`}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button 
                                                            disabled={u.id === user?.id}
                                                            onClick={() => handleDeleteUser(u.id)}
                                                            className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition-colors disabled:opacity-30"
                                                            title="Eliminar usuario"
                                                        >
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </AuthGuard>
    )
}
