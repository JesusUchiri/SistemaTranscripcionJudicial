'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { AuthGuard } from '@/components/auth/AuthGuard'
import ActaEditor from '@/components/acta/ActaEditor'
import { Acta, Audiencia } from '@/types'
import { motion, AnimatePresence } from 'framer-motion'
import { 
    ChevronLeft, 
    FileText, 
    History, 
    Save, 
    CheckCircle2, 
    Download, 
    Zap, 
    Clock,
    Layout,
    AlertCircle,
    Loader2
} from 'lucide-react'

/* ── Pasos de generación ────────────────────────────────── */
const PASOS_GENERACION = [
    'Recopilando segmentos...',
    'Identificando roles...',
    'Redacción con Claude AI...',
    'Procesando bloques...',
    'Aplicando formato oficial...'
]

const POLL_INTERVAL_MS = 8000

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
    const [pasoActual, setPasoActual] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)
    const pasoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const canApprove = useMemo(() => user?.rol === 'admin' || user?.rol === 'supervisor', [user])

    const fetchAudienciaYActas = useCallback(async () => {
        try {
            const resAud = await api.get<Audiencia>(`/api/audiencias/${audienciaId}`)
            setAudiencia(resAud.data)
            const resActas = await api.get<Acta[]>(`/api/audiencias/${audienciaId}/actas`)
            const sorted = resActas.data.sort((a, b) => b.version - a.version)
            setActas(sorted)
            if (sorted.length > 0 && !currentActa) {
                const latest = sorted[0]
                setCurrentActa(latest)
                setEditorContent(latest.contenido_editado || latest.contenido_llm || '')
            }
        } catch (err) { console.error(err) }
    }, [audienciaId, currentActa])

    useEffect(() => { fetchAudienciaYActas() }, [fetchAudienciaYActas])

    const generarBorrador = async () => {
        setIsGenerating(true)
        setError(null)
        setPasoActual(0)
        pasoIntervalRef.current = setInterval(() => {
            setPasoActual(p => Math.min(p + 1, PASOS_GENERACION.length - 1))
        }, 15000)

        try {
            const formato = audiencia?.instancia === 'sala_apelaciones' ? 'B' : 'A'
            const res = await api.post<Acta>(`/api/audiencias/${audienciaId}/actas/generar`, { formato })
            let acta = res.data
            while (acta.estado === 'generando') {
                await new Promise(r => setTimeout(p => r(p), POLL_INTERVAL_MS))
                const poll = await api.get<Acta[]>(`/api/audiencias/${audienciaId}/actas`)
                acta = poll.data.find(a => a.id === acta.id) || poll.data[0]
            }
            if (acta.estado === 'error') setError('Error en Claude AI.')
            else { 
                setCurrentActa(acta)
                setEditorContent(acta.contenido_editado || acta.contenido_llm || '')
                await fetchAudienciaYActas()
            }
        } catch (err: any) { setError('Error en generación.') } 
        finally {
            if (pasoIntervalRef.current) clearInterval(pasoIntervalRef.current)
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
            setSuccessMsg('Documento actualizado.')
            setTimeout(() => setSuccessMsg(null), 3000)
            if (nuevoEstado) await fetchAudienciaYActas()
        } catch { setError('Error al guardar.') }
        finally { setIsSaving(false) }
    }

    const aprobarActa = async () => {
        if (!currentActa || !canApprove) return
        try {
            await api.post(`/api/audiencias/${audienciaId}/actas/${currentActa.id}/aprobar`)
            setSuccessMsg('Acta aprobada oficialmente.')
            await fetchAudienciaYActas()
        } catch { setError('Error al aprobar.') }
    }

    const descargarActa = async (formato: 'pdf' | 'docx') => {
        if (!currentActa) return
        try {
            const res = await api.get(`/api/audiencias/${audienciaId}/actas/${currentActa.id}/exportar/${formato}`, { responseType: 'blob' })
            const url = window.URL.createObjectURL(new Blob([res.data]))
            const link = document.createElement('a')
            link.href = url
            link.setAttribute('download', `acta_${audiencia?.expediente || 'oficial'}.${formato}`)
            document.body.appendChild(link)
            link.click()
            link.remove()
        } catch { setError('Error en descarga.') }
    }

    if (!audiencia) return (
        <div className="fixed inset-0 flex items-center justify-center bg-[#FDFCFB]">
            <Loader2 className="w-10 h-10 animate-spin text-[#A68246]" />
        </div>
    )

    return (
        <AuthGuard>
            <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#FDFCFB]">
                {/* ── Header Ink & Gold ────────────────────────── */}
                <header className="px-8 py-4 bg-white border-b border-[#1B3A5C]/5 flex items-center justify-between z-30">
                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => router.push(`/audiencia/${audienciaId}`)}
                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1B3A5C]/5 text-[#1B3A5C] hover:bg-[#1B3A5C]/10 transition-all"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-sm font-bold text-[#1B3A5C]">Acta: {audiencia.expediente}</h1>
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                    currentActa?.estado === 'aprobada' ? 'bg-green-50 text-green-600' : 'bg-[#A68246]/10 text-[#A68246]'
                                }`}>
                                    {currentActa?.estado || 'Sin Iniciar'}
                                </span>
                            </div>
                            <p className="text-[10px] text-[#1B3A5C]/40 uppercase font-bold tracking-widest mt-0.5">
                                {audiencia.tipo_audiencia} · Versión {currentActa?.version || 0}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <AnimatePresence>
                            {successMsg && (
                                <motion.span initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="text-[10px] font-bold text-green-600 uppercase mr-4">
                                    {successMsg}
                                </motion.span>
                            )}
                        </AnimatePresence>

                        {!currentActa ? (
                            <button onClick={generarBorrador} disabled={isGenerating} className="btn-primary flex items-center gap-2 !py-2.5 !rounded-xl !text-xs">
                                <Zap className="w-4 h-4" /> Generar Borrador
                            </button>
                        ) : (
                            <>
                                {currentActa.estado !== 'aprobada' && (
                                    <div className="flex items-center gap-2 bg-[#1B3A5C]/5 p-1 rounded-xl">
                                        <button onClick={() => guardarCambios()} disabled={isSaving} className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C] hover:bg-white hover:shadow-sm transition-all flex items-center gap-2">
                                            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Guardar
                                        </button>
                                        <button onClick={() => guardarCambios('en_revision')} disabled={isSaving} className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C] hover:bg-white hover:shadow-sm transition-all">
                                            Revisión
                                        </button>
                                    </div>
                                )}
                                {canApprove && currentActa.estado === 'en_revision' && (
                                    <button onClick={aprobarActa} className="btn-primary !bg-green-700 !py-2.5 !rounded-xl !text-xs">
                                        Aprobar Oficialmente
                                    </button>
                                )}
                                <div className="flex gap-1">
                                    <button onClick={() => descargarActa('docx')} className="w-10 h-10 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all">
                                        <Download className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => descargarActa('pdf')} className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-all">
                                        <FileText className="w-4 h-4" />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </header>

                <main className="flex-1 flex overflow-hidden">
                    {/* ── Sidebar de Versiones ────────────────────── */}
                    <aside className="w-64 xl:w-72 shrink-0 bg-white border-r border-[#1B3A5C]/5 flex flex-col shadow-xl z-20">
                        <div className="px-6 py-4 border-b border-[#1B3A5C]/5 flex items-center gap-2">
                            <History className="w-4 h-4 text-[#A68246]" />
                            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]">Historial</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                            {actas.map(a => (
                                <button
                                    key={a.id}
                                    onClick={() => { setCurrentActa(a); setEditorContent(a.contenido_editado || a.contenido_llm || '') }}
                                    className={`w-full p-4 rounded-2xl border text-left transition-all ${
                                        a.id === currentActa?.id 
                                        ? 'bg-[#1B3A5C]/5 border-[#1B3A5C]/10 shadow-sm' 
                                        : 'bg-white border-transparent hover:bg-[#1B3A5C]/[0.02]'
                                    }`}
                                >
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold text-[#1B3A5C]">Versión {a.version}</span>
                                        <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                            a.estado === 'aprobada' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                        }`}>{a.estado}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[9px] text-[#1B3A5C]/40 font-bold uppercase tracking-tighter">
                                        <Clock className="w-3 h-3" />
                                        {new Date(a.updated_at).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </aside>

                    {/* ── Área del Editor ────────────────────────── */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#F7F5F2]/50 relative p-12 flex justify-center">
                        <div className="w-full max-w-[850px]">
                            {currentActa ? (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="canvas-document animate-fade-in">
                                    <div className="canvas-document__header px-16 pt-12 pb-8 flex items-center justify-between border-b-2 border-[#1B3A5C]">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="w-6 h-6 bg-[#1B3A5C] rounded flex items-center justify-center text-white text-[10px] font-bold">J</div>
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40">Poder Judicial del Perú</span>
                                            </div>
                                            <h2 className="text-xl font-bold text-[#1B3A5C]" style={{ fontFamily: 'var(--font-display)' }}>Acta de Audiencia Judicial</h2>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[10px] font-bold text-[#A68246] uppercase">Expediente Digital</span>
                                            <p className="text-xs font-bold text-[#1B3A5C]">{audiencia.expediente}</p>
                                        </div>
                                    </div>
                                    
                                    <div className="px-16 py-12">
                                        <ActaEditor 
                                            key={currentActa.id} 
                                            initialContent={currentActa.contenido_editado || currentActa.contenido_llm || ''} 
                                            onChange={setEditorContent} 
                                            editable={currentActa.estado !== 'aprobada'} 
                                        />
                                    </div>
                                </motion.div>
                            ) : (
                                <div className="h-[600px] flex flex-col items-center justify-center text-center space-y-6">
                                    <div className="w-20 h-20 bg-white rounded-3xl border border-[#1B3A5C]/10 shadow-xl flex items-center justify-center">
                                        <FileText className="w-10 h-10 text-[#1B3A5C]/20" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-[#1B3A5C]">Inicie la Redacción</h3>
                                        <p className="text-sm text-[#1B3A5C]/40 max-w-xs mx-auto">Use el motor de Claude AI para transformar la transcripción en un acta oficial estructurada.</p>
                                    </div>
                                    <button onClick={generarBorrador} disabled={isGenerating} className="btn-primary flex items-center gap-3">
                                        <Zap className="w-5 h-5" /> Comenzar con IA
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </main>

                {/* ── Overlay de Generación Estilizado ───────────── */}
                <AnimatePresence>
                    {isGenerating && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B3A5C]/40 backdrop-blur-sm">
                            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white rounded-[32px] p-10 shadow-2xl w-full max-w-md border border-[#A68246]/20">
                                <div className="flex flex-col items-center">
                                    <div className="relative mb-8">
                                        <div className="w-20 h-20 border-4 border-[#A68246]/10 rounded-full" />
                                        <div className="absolute inset-0 w-20 h-20 border-4 border-[#A68246] border-t-transparent rounded-full animate-spin" />
                                        <Zap className="absolute inset-0 m-auto w-8 h-8 text-[#A68246]" />
                                    </div>
                                    
                                    <h3 className="text-xl font-bold text-[#1B3A5C] mb-2">Redactando Acta Judicial</h3>
                                    <p className="text-xs text-[#1B3A5C]/40 uppercase font-bold tracking-widest mb-8">Inteligencia Artificial Claude Sonnet</p>

                                    <div className="w-full space-y-3">
                                        {PASOS_GENERACION.map((paso, i) => (
                                            <div key={i} className={`flex items-center gap-4 text-xs font-medium transition-all ${i === pasoActual ? 'text-[#1B3A5C]' : i < pasoActual ? 'text-green-600' : 'text-[#1B3A5C]/20'}`}>
                                                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${i < pasoActual ? 'bg-green-50 text-green-600' : i === pasoActual ? 'bg-[#A68246] text-white shadow-lg shadow-[#A68246]/20' : 'bg-gray-50'}`}>
                                                    {i < pasoActual ? '✓' : i + 1}
                                                </div>
                                                {paso}
                                            </div>
                                        ))}
                                    </div>
                                    <p className="mt-10 text-[10px] text-[#1B3A5C]/30 font-bold uppercase tracking-tighter italic text-center">Esto puede tomar entre 2 y 5 minutos dependiendo de la duración de la audiencia.</p>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </AuthGuard>
    )
}
