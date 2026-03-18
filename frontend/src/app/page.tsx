'use client'

/**
 * Página principal — Dashboard del Digitador Judicial.
 * Lista audiencias, acciones por fila, filtros rápidos.
 */
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import type { Audiencia } from '@/types'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'

const ESTADO_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
    pendiente:   { bg: 'rgba(113,128,150,0.1)',  text: '#718096', label: 'Pendiente'   },
    en_curso:    { bg: 'rgba(37,99,235,0.1)',    text: '#2563EB', label: 'En curso'    },
    transcrita:  { bg: 'rgba(217,119,6,0.1)',    text: '#D97706', label: 'Transcrita'  },
    en_revision: { bg: 'rgba(234,88,12,0.1)',    text: '#EA580C', label: 'En revisión' },
    finalizada:  { bg: 'rgba(5,150,105,0.1)',    text: '#059669', label: 'Finalizada'  },
}

function saludo(): string {
    const h = new Date().getHours()
    if (h < 12) return 'Buenos días'
    if (h < 19) return 'Buenas tardes'
    return 'Buenas noches'
}

type Filtro = 'todas' | 'pendiente' | 'en_curso' | 'transcrita' | 'en_revision' | 'finalizada'

const FILTROS: { key: Filtro; label: string }[] = [
    { key: 'todas',       label: 'Todas'       },
    { key: 'pendiente',   label: 'Pendiente'   },
    { key: 'en_curso',    label: 'En curso'    },
    { key: 'transcrita',  label: 'Transcrita'  },
    { key: 'en_revision', label: 'En revisión' },
    { key: 'finalizada',  label: 'Finalizada'  },
]

export default function DashboardPage() {
    const router = useRouter()
    const { user, logout } = useAuthStore()
    const [audiencias, setAudiencias] = useState<Audiencia[]>([])
    const [loading, setLoading] = useState(true)
    const [filtro, setFiltro] = useState<Filtro>('todas')

    useEffect(() => {
        if (user?.rol === 'admin') {
            router.replace('/admin')
            return
        }
        fetchAudiencias()
    }, [user, router])

    // Refresca cuando el usuario vuelve a la pestaña
    useEffect(() => {
        const refresh = () => fetchAudiencias()
        const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
        window.addEventListener('focus', refresh)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            window.removeEventListener('focus', refresh)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [])

    const fetchAudiencias = useCallback(async () => {
        try {
            const { data } = await api.get('/api/audiencias')
            setAudiencias(data.items || [])
        } catch {
            setAudiencias([])
        } finally {
            setLoading(false)
        }
    }, [])

    const handleLogout = async () => {
        await logout()
        router.replace('/login')
    }

    // ── Stats ──────────────────────────────────────────
    const hoy = new Date().toISOString().split('T')[0]
    const stats = [
        { label: 'Audiencias hoy',  value: audiencias.filter(a => a.fecha === hoy).length,                  highlight: false },
        { label: 'En curso',        value: audiencias.filter(a => a.estado === 'en_curso').length,           highlight: true  },
        { label: 'Pendientes',      value: audiencias.filter(a => a.estado === 'pendiente').length,          highlight: false },
        { label: 'En revisión',     value: audiencias.filter(a => a.estado === 'en_revision').length,        highlight: true  },
    ]

    const listaFiltrada = filtro === 'todas'
        ? audiencias
        : audiencias.filter(a => a.estado === filtro)

    // Audiencias con transcripción lista → puede ir a Acta
    const tieneAccesoActa = (a: Audiencia) =>
        a.estado === 'transcrita' || a.estado === 'en_revision' || a.estado === 'finalizada'

    const rolLabel = user?.rol === 'transcriptor' ? 'Digitador Judicial'
        : user?.rol === 'supervisor' ? 'Supervisor'
        : user?.rol ?? ''

    return (
        <AuthGuard>
            <div className="h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>

                {/* ── Header ──────────────────────────────────── */}
                <header
                    className="shrink-0 px-6 sm:px-8 py-3 flex items-center justify-between gap-4"
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}
                >
                    {/* Branding */}
                    <div className="flex items-center gap-3">
                        <div className="logo-monogram shrink-0">J</div>
                        <div>
                            <h1 className="text-sm font-bold tracking-tight"
                                style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                                JudiScribe
                            </h1>
                            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                Sistema de Transcripción Judicial · Cusco
                            </p>
                        </div>
                    </div>

                    {/* User + logout */}
                    <div className="flex items-center gap-3">
                        <div className="hidden sm:block text-right">
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                {user?.nombre}
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                {rolLabel}
                            </p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                            style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-muted)',
                            }}
                        >
                            Cerrar sesión
                        </button>
                    </div>
                </header>

                {/* ── Contenido principal (scrollable) ────────── */}
                <main className="flex-1 min-h-0 overflow-y-auto">
                    <div className="max-w-6xl mx-auto px-6 sm:px-8 py-8 space-y-8">

                        {/* Saludo + acciones primarias */}
                        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold"
                                    style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                                    {saludo()}, {user?.nombre?.split(' ')[0]}.
                                </h2>
                                <p className="text-xs mt-1 capitalize" style={{ color: 'var(--text-muted)' }}>
                                    {new Date().toLocaleDateString('es-PE', {
                                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                                    })}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => router.push('/transcribir')}
                                    className="px-4 py-2 rounded-xl text-xs font-medium transition-all hover:brightness-95"
                                    style={{
                                        background: 'var(--bg-surface)',
                                        border: '1px solid var(--border-default)',
                                        color: 'var(--text-secondary)',
                                    }}
                                >
                                    Subir Audio
                                </button>
                                <button
                                    onClick={() => router.push('/audiencia/nueva')}
                                    className="px-5 py-2 rounded-xl text-xs font-semibold transition-all hover:brightness-110"
                                    style={{
                                        background: 'var(--accent-gold)',
                                        color: 'white',
                                        boxShadow: '0 2px 10px rgba(166,130,70,0.3)',
                                    }}
                                >
                                    + Nueva Audiencia
                                </button>
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {stats.map(s => (
                                <div
                                    key={s.label}
                                    className="stat-card"
                                    style={s.highlight && s.value > 0
                                        ? { borderColor: 'rgba(166,130,70,0.35)' }
                                        : {}
                                    }
                                >
                                    <span
                                        className="stat-card__value"
                                        style={s.highlight && s.value > 0 ? { color: 'var(--accent-gold)' } : {}}
                                    >
                                        {s.value}
                                    </span>
                                    <span className="stat-card__label">{s.label}</span>
                                </div>
                            ))}
                        </div>

                        {/* Filtros + Actualizar */}
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex gap-1.5 flex-wrap">
                                {FILTROS.map(f => {
                                    const count = f.key === 'todas'
                                        ? audiencias.length
                                        : audiencias.filter(a => a.estado === f.key).length
                                    const activo = filtro === f.key
                                    return (
                                        <button
                                            key={f.key}
                                            onClick={() => setFiltro(f.key)}
                                            className="px-3 py-1 rounded-full text-[11px] font-medium transition-all"
                                            style={{
                                                background: activo ? 'var(--text-primary)' : 'var(--bg-surface)',
                                                color: activo ? 'var(--bg-primary)' : 'var(--text-muted)',
                                                border: `1px solid ${activo ? 'var(--text-primary)' : 'var(--border-subtle)'}`,
                                            }}
                                        >
                                            {f.label}
                                            {count > 0 && (
                                                <span className={`ml-1.5 ${activo ? 'opacity-70' : 'opacity-50'}`}>
                                                    {count}
                                                </span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                            <button
                                onClick={fetchAudiencias}
                                className="text-[11px] px-3 py-1 rounded-lg transition-colors hover:brightness-95 shrink-0"
                                style={{
                                    color: 'var(--text-muted)',
                                    border: '1px solid var(--border-subtle)',
                                    background: 'var(--bg-surface)',
                                }}
                            >
                                ↻ Actualizar
                            </button>
                        </div>

                        {/* Tabla de audiencias */}
                        {loading ? (
                            <div className="space-y-2">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="h-14 rounded-xl skeleton-shimmer" />
                                ))}
                            </div>
                        ) : listaFiltrada.length === 0 ? (
                            <div
                                className="rounded-2xl p-12 text-center"
                                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                            >
                                {audiencias.length === 0 ? (
                                    <>
                                        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                                            No hay audiencias registradas
                                        </p>
                                        <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>
                                            Crea la primera sesión para comenzar a transcribir.
                                        </p>
                                        <button
                                            onClick={() => router.push('/audiencia/nueva')}
                                            className="px-5 py-2.5 rounded-xl text-sm font-semibold hover:brightness-110 transition-all"
                                            style={{ background: 'var(--accent-gold)', color: 'white' }}
                                        >
                                            + Nueva Audiencia
                                        </button>
                                    </>
                                ) : (
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                        No hay audiencias con el filtro "{FILTROS.find(f => f.key === filtro)?.label}".
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div
                                className="rounded-2xl overflow-hidden"
                                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                            >
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm min-w-[700px]">
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                                                {['Expediente', 'Tipo de Audiencia', 'Juzgado', 'Fecha / Hora', 'Estado', 'Acciones'].map(h => (
                                                    <th
                                                        key={h}
                                                        className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-wider"
                                                        style={{ color: 'var(--text-muted)' }}
                                                    >
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {listaFiltrada.map((a, idx) => {
                                                const estadoCfg = ESTADO_CONFIG[a.estado] ?? ESTADO_CONFIG.pendiente
                                                const esUltima = idx === listaFiltrada.length - 1
                                                return (
                                                    <tr
                                                        key={a.id}
                                                        onClick={() => router.push(`/audiencia/${a.id}`)}
                                                        className="cursor-pointer transition-colors hover:bg-[rgba(166,130,70,0.04)]"
                                                        style={!esUltima ? { borderBottom: '1px solid var(--border-subtle)' } : {}}
                                                    >
                                                        <td className="px-5 py-3.5">
                                                            <span
                                                                className="text-xs font-semibold"
                                                                style={{
                                                                    color: 'var(--text-primary)',
                                                                    fontFamily: 'var(--font-mono)',
                                                                }}
                                                            >
                                                                {a.expediente}
                                                            </span>
                                                        </td>
                                                        <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                                            {a.tipo_audiencia}
                                                        </td>
                                                        <td className="px-5 py-3.5 text-xs max-w-[200px] truncate" style={{ color: 'var(--text-muted)' }}>
                                                            {a.juzgado}
                                                        </td>
                                                        <td className="px-5 py-3.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                                                            {a.fecha}
                                                            {a.hora_inicio && (
                                                                <span className="ml-1.5 opacity-50">
                                                                    {a.hora_inicio.slice(0, 5)}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-5 py-3.5">
                                                            <span
                                                                className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                                                                style={{ background: estadoCfg.bg, color: estadoCfg.text }}
                                                            >
                                                                {estadoCfg.label}
                                                            </span>
                                                        </td>
                                                        <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    onClick={() => router.push(`/audiencia/${a.id}`)}
                                                                    className="px-3 py-1 rounded-lg text-[11px] font-medium transition-all hover:brightness-95"
                                                                    style={{
                                                                        background: 'var(--bg-secondary)',
                                                                        border: '1px solid var(--border-subtle)',
                                                                        color: 'var(--text-secondary)',
                                                                    }}
                                                                >
                                                                    Abrir
                                                                </button>
                                                                {tieneAccesoActa(a) && (
                                                                    <button
                                                                        onClick={() => router.push(`/audiencia/${a.id}/acta`)}
                                                                        className="px-3 py-1 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
                                                                        style={{
                                                                            background: 'rgba(166,130,70,0.1)',
                                                                            border: '1px solid rgba(166,130,70,0.25)',
                                                                            color: 'var(--accent-gold)',
                                                                        }}
                                                                    >
                                                                        Acta
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                    </div>
                </main>
            </div>
        </AuthGuard>
    )
}
