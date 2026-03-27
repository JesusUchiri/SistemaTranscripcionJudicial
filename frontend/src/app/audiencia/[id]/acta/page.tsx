'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { AuthGuard } from '@/components/auth/AuthGuard'
import ActaEditor from '@/components/acta/ActaEditor'
import { Acta, Audiencia } from '@/types'

/* ── Pasos de generación para el overlay de progreso ─────────────────── */
const PASOS_GENERACION = [
    'Recopilando segmentos de transcripción...',
    'Identificando hablantes y roles...',
    'Enviando a Claude Sonnet 4...',
    'Generando redacción judicial formal...',
    'Aplicando formato oficial...',
]

export default function PaginaActa() {
    const params = useParams()
    const audienciaId = params.id as string
    const { user } = useAuthStore()

    const [audiencia, setAudiencia] = useState<Audiencia | null>(null)
    const [actas, setActas] = useState<Acta[]>([])
    const [currentActa, setCurrentActa] = useState<Acta | null>(null)
    const [editorContent, setEditorContent] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)
    const [pasoActual, setPasoActual] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)
    const pasoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const canApprove = useMemo(
        () => user?.rol === 'admin' || user?.rol === 'supervisor',
        [user],
    )

    const fetchAudienciaYActas = useCallback(async () => {
        try {
            const resAud = await api.get<Audiencia>(`/api/audiencias/${audienciaId}`)
            setAudiencia(resAud.data)

            const resActas = await api.get<Acta[]>(`/api/audiencias/${audienciaId}/actas`)
            setActas(resActas.data)

            if (resActas.data.length > 0) {
                const latest = resActas.data[0]
                setCurrentActa(latest)
                setEditorContent(latest.contenido_editado || latest.contenido_llm || '')
            }
        } catch (err) {
            console.error('Error cargando acta:', err)
        }
    }, [audienciaId])

    useEffect(() => {
        fetchAudienciaYActas()
    }, [fetchAudienciaYActas])

    // Ctrl+S para guardar
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault()
                if (currentActa && currentActa.estado !== 'aprobada' && !isSaving) {
                    guardarCambios()
                }
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [currentActa, isSaving, editorContent])

    // Limpiar intervalo al desmontar
    useEffect(() => {
        return () => {
            if (pasoIntervalRef.current) clearInterval(pasoIntervalRef.current)
        }
    }, [])

    const mostrarExito = (msg: string) => {
        setSuccessMsg(msg)
        setTimeout(() => setSuccessMsg(null), 4000)
    }

    const generarBorrador = async () => {
        setIsGenerating(true)
        setError(null)
        setPasoActual(0)

        // Avanzar pasos cada ~8s para dar feedback visual mientras Claude genera
        let paso = 0
        pasoIntervalRef.current = setInterval(() => {
            paso = Math.min(paso + 1, PASOS_GENERACION.length - 1)
            setPasoActual(paso)
        }, 8000)

        try {
            const formato = audiencia?.instancia === 'sala_apelaciones' ? 'B' : 'A'
            await api.post(
                `/api/audiencias/${audienciaId}/actas/generar`,
                { formato },
                { timeout: 170000 }, // 170s — dentro del límite nginx (180s) para audiencias largas
            )
            await fetchAudienciaYActas()
            mostrarExito('Acta generada correctamente.')
        } catch (err: any) {
            setError(
                err.response?.data?.detail ||
                err.message ||
                'No se pudo generar el acta. Verifica que existan segmentos de transcripción.',
            )
        } finally {
            if (pasoIntervalRef.current) clearInterval(pasoIntervalRef.current)
            setIsGenerating(false)
            setPasoActual(0)
        }
    }

    const guardarCambios = async (nuevoEstado?: string) => {
        if (!currentActa) return
        setIsSaving(true)
        setError(null)
        try {
            const payload: any = { contenido_editado: editorContent }
            if (nuevoEstado) payload.estado = nuevoEstado

            const res = await api.put<Acta>(
                `/api/audiencias/${audienciaId}/actas/${currentActa.id}`,
                payload,
            )
            setCurrentActa(res.data)
            if (nuevoEstado) await fetchAudienciaYActas()
            mostrarExito('Cambios guardados.')
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Error guardando los cambios.')
        } finally {
            setIsSaving(false)
        }
    }

    const aprobarActa = async () => {
        if (!currentActa || !canApprove) return
        setError(null)
        try {
            const res = await api.post<Acta>(
                `/api/audiencias/${audienciaId}/actas/${currentActa.id}/aprobar`,
            )
            setCurrentActa(res.data)
            await fetchAudienciaYActas()
            mostrarExito('Acta aprobada oficialmente.')
        } catch (err: any) {
            setError(
                'No se pudo aprobar el acta. ' +
                (err.response?.data?.detail || err.message || ''),
            )
        }
    }

    const descargarActa = async (formato: 'pdf' | 'docx') => {
        if (!currentActa) return
        setError(null)
        try {
            const res = await api.get(
                `/api/audiencias/${audienciaId}/actas/${currentActa.id}/exportar/${formato}`,
                { responseType: 'blob' },
            )
            const url = window.URL.createObjectURL(new Blob([res.data]))
            const link = document.createElement('a')
            link.href = url
            let fileName = `acta_${audiencia?.expediente || 'oficial'}.${formato}`
            const cd = res.headers['content-disposition']
            if (cd) {
                const m = cd.match(/filename="(.+)"/)
                if (m?.[1]) fileName = m[1]
            }
            link.setAttribute('download', fileName)
            document.body.appendChild(link)
            link.click()
            link.parentNode?.removeChild(link)
            window.URL.revokeObjectURL(url)
        } catch {
            setError('Error al descargar el documento.')
        }
    }

    if (!audiencia) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
                <div
                    className="w-10 h-10 rounded-full animate-spin border-2"
                    style={{
                        borderColor: 'var(--accent-gold)',
                        borderTopColor: 'transparent',
                    }}
                />
            </div>
        )
    }

    const estadoVisual =
        currentActa?.estado === 'aprobada'
            ? 'Aprobada'
            : currentActa?.estado === 'en_revision'
                ? 'En Revisión'
                : 'Borrador'

    return (
        <AuthGuard>
            <div className="h-screen flex flex-col bg-[var(--bg-primary)]">

                {/* ── Header ──────────────────────────────────────────── */}
                <header
                    className="flex items-center justify-between px-6 py-3 shrink-0 z-10 sticky top-0"
                    style={{
                        background: 'var(--bg-secondary)',
                        borderBottom: '1px solid var(--border-subtle)',
                    }}
                >
                    <div className="flex items-center gap-4 min-w-0">
                        <button
                            onClick={() => (window.location.href = `/audiencia/${audienciaId}`)}
                            className="text-xs px-3 py-1.5 rounded-lg shrink-0 transition-all"
                            style={{
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--bg-surface)',
                                color: 'var(--text-muted)',
                            }}
                        >
                            Volver
                        </button>
                        <div className="min-w-0">
                            <h1
                                className="text-sm font-bold truncate"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                Acta Oficial: {audiencia.expediente}
                            </h1>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {audiencia.tipo_audiencia} — v.{currentActa?.version ?? 0}
                                {currentActa && (
                                    <span
                                        className="ml-2 font-mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            color: 'var(--text-muted)',
                                        }}
                                    >
                                        {estadoVisual}
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {currentActa?.estado !== 'aprobada' && (
                            <button
                                onClick={generarBorrador}
                                disabled={isGenerating}
                                className="px-4 py-2 rounded text-xs font-semibold transition-all disabled:opacity-50"
                                style={{
                                    background: 'var(--accent-gold)',
                                    color: '#fff',
                                }}
                            >
                                {isGenerating
                                    ? 'Generando...'
                                    : currentActa
                                        ? `Nueva Versión (v${currentActa.version + 1})`
                                        : 'Generar Borrador'}
                            </button>
                        )}

                        {currentActa && currentActa.estado !== 'aprobada' && (
                            <>
                                <button
                                    onClick={() => guardarCambios()}
                                    disabled={isSaving}
                                    className="px-3 py-2 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border-subtle)',
                                        color: 'var(--text-secondary)',
                                    }}
                                >
                                    {isSaving ? 'Guardando...' : 'Guardar'}
                                </button>

                                {currentActa.estado === 'borrador' && (
                                    <button
                                        onClick={() => guardarCambios('en_revision')}
                                        disabled={isSaving}
                                        className="px-3 py-2 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                        style={{
                                            background: 'rgba(37,99,235,0.08)',
                                            border: '1px solid rgba(37,99,235,0.25)',
                                            color: '#2563eb',
                                        }}
                                    >
                                        Enviar a Revisión
                                    </button>
                                )}

                                {canApprove && currentActa.estado === 'en_revision' && (
                                    <button
                                        onClick={aprobarActa}
                                        className="px-4 py-2 rounded text-xs font-semibold transition-all"
                                        style={{
                                            background: '#16a34a',
                                            color: '#fff',
                                        }}
                                    >
                                        Aprobar Acta
                                    </button>
                                )}
                            </>
                        )}

                        {currentActa && (
                            <>
                                {currentActa.estado === 'aprobada' && (
                                    <span
                                        className="px-3 py-2 rounded text-xs font-medium"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border-subtle)',
                                            color: 'var(--text-muted)',
                                        }}
                                    >
                                        Aprobada Oficialmente
                                    </span>
                                )}
                                <button
                                    onClick={() => descargarActa('docx')}
                                    className="px-3 py-2 rounded text-xs font-semibold transition-colors"
                                    style={{ background: '#2563eb', color: '#fff' }}
                                    title={
                                        currentActa.estado !== 'aprobada'
                                            ? 'Exportar borrador (no oficial)'
                                            : 'Descargar acta oficial'
                                    }
                                >
                                    {currentActa.estado === 'aprobada' ? 'DOCX' : 'DOCX (borrador)'}
                                </button>
                                <button
                                    onClick={() => descargarActa('pdf')}
                                    className="px-3 py-2 rounded text-xs font-semibold transition-colors"
                                    style={{ background: '#dc2626', color: '#fff' }}
                                    title={
                                        currentActa.estado !== 'aprobada'
                                            ? 'Exportar borrador (no oficial)'
                                            : 'Descargar acta oficial'
                                    }
                                >
                                    {currentActa.estado === 'aprobada' ? 'PDF' : 'PDF (borrador)'}
                                </button>
                            </>
                        )}
                    </div>
                </header>

                {/* ── Mensajes de estado ───────────────────────────────── */}
                {(error || successMsg) && (
                    <div
                        className="px-6 py-2.5 text-xs flex items-center justify-between"
                        style={{
                            background: error
                                ? 'rgba(220,38,38,0.08)'
                                : 'rgba(22,163,74,0.08)',
                            borderBottom: '1px solid var(--border-subtle)',
                            color: error ? '#dc2626' : '#16a34a',
                        }}
                    >
                        <span>{error ?? successMsg}</span>
                        {error && (
                            <button
                                onClick={() => setError(null)}
                                className="text-xs ml-4 underline opacity-70 hover:opacity-100"
                            >
                                Cerrar
                            </button>
                        )}
                    </div>
                )}

                {/* ── Cuerpo principal ─────────────────────────────────── */}
                <div className="flex-1 flex overflow-hidden">

                    {/* Panel historial */}
                    <aside
                        className="w-56 shrink-0 border-r hidden xl:flex flex-col"
                        style={{
                            background: 'var(--bg-secondary)',
                            borderColor: 'var(--border-subtle)',
                        }}
                    >
                        <div
                            className="px-4 py-3 border-b"
                            style={{ borderColor: 'var(--border-subtle)' }}
                        >
                            <h3
                                className="text-[10px] font-bold uppercase tracking-wider"
                                style={{ color: 'var(--accent-gold)' }}
                            >
                                Versiones
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-2">
                            {actas.map(a => (
                                <div
                                    key={a.id}
                                    onClick={() => {
                                        setCurrentActa(a)
                                        setEditorContent(
                                            a.contenido_editado || a.contenido_llm || '',
                                        )
                                    }}
                                    className="p-3 rounded border text-xs cursor-pointer transition-all"
                                    style={{
                                        background:
                                            a.id === currentActa?.id
                                                ? 'rgba(37,99,235,0.06)'
                                                : 'var(--bg-primary)',
                                        borderColor:
                                            a.id === currentActa?.id
                                                ? 'rgba(37,99,235,0.3)'
                                                : 'var(--border-subtle)',
                                    }}
                                >
                                    <div
                                        className="flex justify-between font-semibold mb-1"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        <span>Versión {a.version}</span>
                                        <span
                                            className="text-[10px] uppercase"
                                            style={{ color: 'var(--text-muted)' }}
                                        >
                                            {a.estado}
                                        </span>
                                    </div>
                                    <div
                                        className="text-[10px] truncate"
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        {new Date(a.updated_at).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                            {actas.length === 0 && (
                                <p
                                    className="text-xs"
                                    style={{ color: 'var(--text-muted)' }}
                                >
                                    Sin versiones.
                                </p>
                            )}
                        </div>
                    </aside>

                    {/* Editor */}
                    <div className="flex-1 overflow-y-auto">
                        {currentActa ? (
                            <ActaEditor
                                key={currentActa.id}
                                initialContent={
                                    currentActa.contenido_editado || currentActa.contenido_llm || ''
                                }
                                onChange={setEditorContent}
                                editable={currentActa.estado !== 'aprobada'}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full min-h-[400px] space-y-4 text-center px-8">
                                <div
                                    className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
                                    style={{
                                        background: 'var(--bg-secondary)',
                                        color: 'var(--text-muted)',
                                        border: '1px solid var(--border-subtle)',
                                    }}
                                >
                                    A
                                </div>
                                <div>
                                    <h3
                                        className="text-base font-semibold"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        Sin acta generada
                                    </h3>
                                    <p
                                        className="text-sm mt-1"
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        Genera el borrador inicial a partir de la transcripción
                                        procesada.
                                    </p>
                                </div>
                                <button
                                    onClick={generarBorrador}
                                    disabled={isGenerating}
                                    className="px-6 py-2.5 rounded text-sm font-semibold disabled:opacity-50"
                                    style={{ background: 'var(--accent-gold)', color: '#fff' }}
                                >
                                    {isGenerating ? 'Generando...' : 'Generar Borrador'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Overlay de generación ────────────────────────────── */}
                {isGenerating && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.45)' }}>
                        <div
                            className="rounded-xl p-8 shadow-2xl w-full max-w-sm mx-4"
                            style={{ background: 'var(--bg-secondary)' }}
                        >
                            {/* Spinner */}
                            <div className="flex justify-center mb-5">
                                <div
                                    className="w-12 h-12 rounded-full animate-spin border-2"
                                    style={{
                                        borderColor: 'var(--accent-gold)',
                                        borderTopColor: 'transparent',
                                    }}
                                />
                            </div>

                            <h3
                                className="text-base font-bold text-center mb-1"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                Generando acta judicial
                            </h3>
                            <p
                                className="text-xs text-center mb-6"
                                style={{ color: 'var(--text-muted)' }}
                            >
                                Claude Sonnet 4 está procesando la transcripción
                            </p>

                            {/* Pasos */}
                            <div className="space-y-2">
                                {PASOS_GENERACION.map((paso, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center gap-3 text-xs py-1 transition-all"
                                        style={{
                                            color:
                                                i < pasoActual
                                                    ? '#16a34a'
                                                    : i === pasoActual
                                                        ? 'var(--text-primary)'
                                                        : 'var(--text-muted)',
                                            opacity: i > pasoActual ? 0.4 : 1,
                                        }}
                                    >
                                        <span
                                            className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold"
                                            style={{
                                                background:
                                                    i < pasoActual
                                                        ? '#16a34a'
                                                        : i === pasoActual
                                                            ? 'var(--accent-gold)'
                                                            : 'var(--bg-primary)',
                                                color:
                                                    i <= pasoActual ? '#fff' : 'var(--text-muted)',
                                                border: '1px solid var(--border-subtle)',
                                            }}
                                        >
                                            {i < pasoActual ? '✓' : i + 1}
                                        </span>
                                        {paso}
                                    </div>
                                ))}
                            </div>

                            <p
                                className="text-[10px] text-center mt-5"
                                style={{ color: 'var(--text-muted)' }}
                            >
                                Este proceso puede tomar 30–60 segundos
                            </p>
                        </div>
                    </div>
                )}

            </div>
        </AuthGuard>
    )
}
