'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { AuthGuard } from '@/components/auth/AuthGuard'
import ActaEditor from '@/components/acta/ActaEditor'
import { Acta, Audiencia } from '@/types'

export default function PaginaActa() {
    const params = useParams()
    const router = useRouter()
    const audienciaId = params.id as string
    const { user } = useAuthStore()

    const [audiencia, setAudiencia] = useState<Audiencia | null>(null)
    const [actas, setActas] = useState<Acta[]>([])
    const [currentActa, setCurrentActa] = useState<Acta | null>(null)
    const [editorContent, setEditorContent] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)

    // Verify if user is supervisor or admin
    const canApprove = useMemo(() => user?.rol === 'admin' || user?.rol === 'supervisor', [user])

    const fetchAudienciaYActas = useCallback(async () => {
        try {
            const resAud = await api.get<Audiencia>(`/api/audiencias/${audienciaId}`)
            setAudiencia(resAud.data)

            const resActas = await api.get<Acta[]>(`/api/audiencias/${audienciaId}/actas`)
            setActas(resActas.data)

            if (resActas.data.length > 0) {
                const latest = resActas.data[0] // Assuming sorted by version desc
                setCurrentActa(latest)
                setEditorContent(latest.contenido_editado || latest.contenido_llm || '')
            }
        } catch (error) {
            console.error('Error cargando acta:', error)
        }
    }, [audienciaId])

    useEffect(() => {
        fetchAudienciaYActas()
    }, [fetchAudienciaYActas])

    const generarBorrador = async () => {
        setIsGenerating(true)
        try {
            const formato = audiencia?.instancia === 'sala_apelaciones' ? 'B' : 'A'
            await api.post(`/api/audiencias/${audienciaId}/actas/generar`, {
                formato: formato
            })
            await fetchAudienciaYActas()
        } catch (error) {
            console.error('Error generando borrador:', error)
            alert('No se pudo generar el acta o aún no existe transcripción.')
        } finally {
            setIsGenerating(false)
        }
    }

    const guardarCambios = async (nuevoEstado?: string) => {
        if (!currentActa) return
        setIsSaving(true)
        try {
            const payload: any = { contenido_editado: editorContent }
            if (nuevoEstado) payload.estado = nuevoEstado

            const res = await api.put<Acta>(`/api/audiencias/${audienciaId}/actas/${currentActa.id}`, payload)
            setCurrentActa(res.data)
            
            // If we sent to revision, reload the list to reflect
            if (nuevoEstado) await fetchAudienciaYActas()
        } catch (error) {
            console.error('Error guardando acta:', error)
            alert('Error guardando los cambios.')
        } finally {
            setIsSaving(false)
        }
    }

    const aprobarActa = async () => {
        if (!currentActa || !canApprove) return
        try {
            const res = await api.post<Acta>(`/api/audiencias/${audienciaId}/actas/${currentActa.id}/aprobar`)
            setCurrentActa(res.data)
            await fetchAudienciaYActas()
            alert('Acta aprobada oficialmente.')
        } catch (error: any) {
            console.error('Error aprobando acta:', error)
            alert('No se pudo aprobar el acta. ' + (error.response?.data?.detail || ''))
        }
    }

    const descargarActa = async (formato: 'pdf' | 'docx') => {
        if (!currentActa) return
        try {
            const res = await api.get(`/api/audiencias/${audienciaId}/actas/${currentActa.id}/exportar/${formato}`, {
                responseType: 'blob'
            })
            // Create blob link to download
            const url = window.URL.createObjectURL(new Blob([res.data]))
            const link = document.createElement('acta_link') as any // trick for ts
            link.href = url
            // Extract filename from header if possible, else default 
            let fileName = `acta_${audiencia?.expediente || 'oficial'}.${formato}`
            const contentDisposition = res.headers['content-disposition']
            if (contentDisposition) {
                const fileNameMatch = contentDisposition.match(/filename="(.+)"/)
                if (fileNameMatch && fileNameMatch.length === 2) {
                    fileName = fileNameMatch[1]
                }
            }
            link.setAttribute('download', fileName)
            document.body.appendChild(link)
            link.click()
            link.parentNode.removeChild(link)
            window.URL.revokeObjectURL(url)
        } catch (error) {
            console.error('Error descargando el documento:', error)
            alert('Error descargando el documento oficial.')
        }
    }

    if (!audiencia) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
                <div className="w-10 h-10 border-3 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }

    const estadoVisual = currentActa?.estado === 'aprobada' 
        ? 'Aprobada Oficialmente' 
        : currentActa?.estado === 'en_revision' 
            ? 'En Revisión por Supervisor' 
            : 'Borrador'

    return (
        <AuthGuard>
            <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
                {/* Header Navbar */}
                <header className="flex items-center justify-between px-6 py-4 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] shrink-0 z-10 sticky top-0">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => window.location.href = `/audiencia/${audienciaId}`}
                            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:brightness-110 text-[var(--text-muted)] transition-all"
                        >
                            ← Volver
                        </button>
                        <div>
                            <h1 className="text-sm font-bold text-[var(--text-primary)]">Acta Oficial: {audiencia.expediente}</h1>
                            <p className="text-xs text-[var(--text-muted)]">
                                {audiencia.tipo_audiencia} — V.{currentActa?.version || 0}
                                {currentActa && <span className="mx-2 font-mono bg-gray-100 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider text-gray-600">{estadoVisual}</span>}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {currentActa?.estado !== 'aprobada' && (
                            <button
                                onClick={generarBorrador}
                                disabled={isGenerating}
                                className="px-5 py-2 rounded text-xs font-semibold bg-[var(--accent-gold)] text-white hover:brightness-110 disabled:opacity-50"
                            >
                                {isGenerating
                                    ? 'Generando con IA...'
                                    : currentActa
                                        ? `↻ Nueva Versión (v${currentActa.version + 1})`
                                        : 'Generar Borrador Inicial'}
                            </button>
                        )}

                        {currentActa && currentActa.estado !== 'aprobada' && (
                            <>
                                <button
                                    onClick={() => guardarCambios()}
                                    disabled={isSaving}
                                    className="px-4 py-2 rounded bg-gray-100 border border-gray-200 text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
                                >
                                    {isSaving ? 'Guardando...' : 'Guardar Progreso'}
                                </button>
                                
                                {currentActa.estado === 'borrador' && (
                                    <button
                                        onClick={() => guardarCambios('en_revision')}
                                        disabled={isSaving}
                                        className="px-4 py-2 rounded bg-blue-50 text-blue-700 border border-blue-200 text-xs font-medium hover:bg-blue-100 transition-colors"
                                    >
                                        Enviar a Revisión
                                    </button>
                                )}

                                {canApprove && currentActa.estado === 'en_revision' && (
                                    <button
                                        onClick={aprobarActa}
                                        className="px-5 py-2 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-700 shadow-sm transition-all shadow-green-600/20"
                                    >
                                        ✓ Aprobar Acta Especialista
                                    </button>
                                )}
                            </>
                        )}
                        
                        {currentActa?.estado === 'aprobada' && (
                            <div className="flex items-center gap-2">
                                <button className="px-3 py-2 rounded text-xs font-medium bg-gray-100 text-gray-500 cursor-not-allowed border border-gray-200" disabled>
                                    🔒 Aprobada Oficialmente
                                </button>
                                <button
                                    onClick={() => descargarActa('docx')}
                                    className="px-4 py-2 rounded text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition"
                                >
                                    Descargar DOCX
                                </button>
                                <button
                                    onClick={() => descargarActa('pdf')}
                                    className="px-4 py-2 rounded text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition"
                                >
                                    Descargar PDF
                                </button>
                            </div>
                        )}
                    </div>
                </header>

                {/* Main Editor Area */}
                <main className="flex-1 overflow-hidden flex bg-gray-50/50">
                    {/* Panel lateral historial (opcional, ocultable) */}
                    <aside className="w-64 border-r border-[var(--border-subtle)] bg-white hidden xl:flex flex-col">
                        <div className="p-4 border-b border-[var(--border-subtle)]">
                            <h3 className="text-xs font-bold text-[var(--accent-gold)] uppercase tracking-wider">Historial de Versiones</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {actas.map(a => (
                                <div
                                    key={a.id}
                                    onClick={() => {
                                        setCurrentActa(a)
                                        setEditorContent(a.contenido_editado || a.contenido_llm || '')
                                    }}
                                    className={`p-3 rounded border text-xs cursor-pointer hover:brightness-95 transition-all ${a.id === currentActa?.id ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'}`}
                                >
                                    <div className="flex justify-between font-semibold mb-1">
                                        <span>Versión {a.version}</span>
                                        <span className="text-[10px] uppercase text-gray-500">{a.estado}</span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 truncate">Actualizada: {new Date(a.updated_at).toLocaleString()}</div>
                                </div>
                            ))}
                            {actas.length === 0 && <div className="text-xs text-gray-400">No hay versiones.</div>}
                        </div>
                    </aside>

                    {/* TipTap Document Area */}
                    <div className="flex-1 h-full overflow-hidden flex flex-col justify-center relative">
                        {currentActa ? (
                            <ActaEditor 
                                initialContent={currentActa.contenido_editado || currentActa.contenido_llm || ''}
                                onChange={setEditorContent}
                                editable={currentActa.estado !== 'aprobada'}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full space-y-4 text-center">
                                <span className="text-4xl">📄</span>
                                <div>
                                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">No hay Acta Generada</h3>
                                    <p className="text-sm text-[var(--text-muted)] mt-1">Genera el borrador inicial con la IA usando la transcripción procesada.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </AuthGuard>
    )
}
