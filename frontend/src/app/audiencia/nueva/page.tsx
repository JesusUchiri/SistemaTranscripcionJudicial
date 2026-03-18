'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import type { AudienciaCreate } from '@/types'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'
import { useEffect } from 'react'

const TIPOS_AUDIENCIA = [
    'Juicio oral',
    'Apelación de sentencia',
    'Prisión preventiva',
    'Lectura de sentencia',
    'Control de acusación',
    'Tutela de derechos',
    'Otro',
]

const INSTANCIAS = [
    { value: 'juzgado_unipersonal', label: 'Juzgado Penal Unipersonal' },
    { value: 'sala_apelaciones', label: 'Sala Penal de Apelaciones' },
]

export default function NuevaAudienciaPage() {
    const router = useRouter()
    const { user } = useAuthStore()
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (user?.rol === 'admin') {
            router.replace('/admin')
        }
    }, [user, router])
    const [form, setForm] = useState<AudienciaCreate>({
        expediente: '',
        juzgado: '',
        tipo_audiencia: 'Juicio oral',
        instancia: 'juzgado_unipersonal',
        fecha: new Date().toISOString().split('T')[0],
        hora_inicio: new Date().toTimeString().slice(0, 5),
        sala: '',
        delito: '',
        imputado_nombre: '',
        agraviado_nombre: '',
        especialista_causa: '',
        especialista_audiencia: '',
    })

    const updateField = (field: keyof AudienciaCreate, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const { data } = await api.post('/api/audiencias', form)
            window.location.href = `/audiencia/${data.id}`
        } catch (err) {
            console.error('Error creating audiencia:', err)
        } finally {
            setLoading(false)
        }
    }

    const inputStyle = {
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-default)',
        color: 'var(--text-primary)',
        caretColor: 'var(--accent-gold)',
    }

    return (
        <AuthGuard>
            <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
            {/* Header */}
            <header className="px-4 sm:px-8 py-4 sm:py-5 flex items-center gap-4"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <button onClick={() => window.location.href = '/'}
                    className="btn-secondary text-xs sm:text-sm">
                    Volver
                </button>
                <h1 className="text-base sm:text-lg font-bold truncate" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                    Nueva Audiencia
                </h1>
            </header>

            <main className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Section: Datos del expediente */}
                    <section className="rounded-2xl p-4 sm:p-6"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                        <h2 className="text-[10px] sm:text-sm font-semibold uppercase tracking-wider mb-4 sm:mb-5" style={{ color: 'var(--text-muted)' }}>
                            Datos del Expediente
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                                    N° Expediente *
                                </label>
                                <input type="text" value={form.expediente}
                                    onChange={(e) => updateField('expediente', e.target.value)}
                                    required placeholder="00123-2024-0-1001-JR-PE-01"
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                                    Juzgado *
                                </label>
                                <input type="text" value={form.juzgado}
                                    onChange={(e) => updateField('juzgado', e.target.value)}
                                    required placeholder="Quinto Juzgado Penal Unipersonal de Cusco"
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                                    Tipo de Audiencia *
                                </label>
                                <select value={form.tipo_audiencia}
                                    onChange={(e) => updateField('tipo_audiencia', e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle}>
                                    {TIPOS_AUDIENCIA.map((t) => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                                    Instancia *
                                </label>
                                <select value={form.instancia}
                                    onChange={(e) => updateField('instancia', e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle}>
                                    {INSTANCIAS.map((i) => (
                                        <option key={i.value} value={i.value}>{i.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                                    Fecha *
                                </label>
                                <input type="date" value={form.fecha}
                                    onChange={(e) => updateField('fecha', e.target.value)}
                                    required className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                                    Hora inicio *
                                </label>
                                <input type="time" value={form.hora_inicio}
                                    onChange={(e) => updateField('hora_inicio', e.target.value)}
                                    required className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                        </div>
                    </section>

                    {/* Section: Datos de la causa */}
                    <section className="rounded-2xl p-4 sm:p-6"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                        <h2 className="text-[10px] sm:text-sm font-semibold uppercase tracking-wider mb-4 sm:mb-5" style={{ color: 'var(--text-muted)' }}>
                            Datos de la Causa
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Sala</label>
                                <input type="text" value={form.sala || ''}
                                    onChange={(e) => updateField('sala', e.target.value)}
                                    placeholder="Google Meet / 11va Sala"
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Delito</label>
                                <input type="text" value={form.delito || ''}
                                    onChange={(e) => updateField('delito', e.target.value)}
                                    placeholder="Robo agravado"
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Imputado</label>
                                <input type="text" value={form.imputado_nombre || ''}
                                    onChange={(e) => updateField('imputado_nombre', e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Agraviado</label>
                                <input type="text" value={form.agraviado_nombre || ''}
                                    onChange={(e) => updateField('agraviado_nombre', e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Especialista de causa</label>
                                <input type="text" value={form.especialista_causa || ''}
                                    onChange={(e) => updateField('especialista_causa', e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Especialista de audiencia</label>
                                <input type="text" value={form.especialista_audiencia || ''}
                                    onChange={(e) => updateField('especialista_audiencia', e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                            </div>
                        </div>
                    </section>

                    <button type="submit" disabled={loading}
                        className="btn-primary w-full py-3.5 text-sm uppercase tracking-wide disabled:opacity-50">
                        {loading ? 'Creando...' : 'Crear Audiencia e Iniciar'}
                    </button>
                </form>
            </main>
        </div>
        </AuthGuard>
    )
}
