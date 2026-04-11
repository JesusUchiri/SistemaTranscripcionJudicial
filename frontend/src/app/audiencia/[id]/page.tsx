'use client'

/**
 * Página de transcripción de audiencia — Vista principal del Canvas.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAudioCapture } from '@/hooks/useAudioCapture'
import { useDeepgramSocket } from '@/hooks/useDeepgramSocket'
import TranscriptionCanvas, { type TranscriptionCanvasHandle } from '@/components/canvas/TranscriptionCanvas'
import PanelHablantes from '@/components/speakers/PanelHablantes'
import ReproductorAudio, { type ReproductorAudioHandle } from '@/components/audio/ReproductorAudio'
import BarraEstado from '@/components/status/BarraEstado'
import PanelMarcadores from '@/components/markers/PanelMarcadores'
import AtajosFrases from '@/components/shortcuts/AtajosFrases'
import RevisionBatchPanel from '@/components/canvas/RevisionBatchPanel'
import PanelVariables, { type VariableDeteccion } from '@/components/variables/PanelVariables'
import api from '@/lib/api'
import { apiBaseUrl } from '@/lib/urls'
import type { Audiencia, Segmento } from '@/types'
import { motion, AnimatePresence } from 'framer-motion'
import { 
    ChevronLeft, 
    FileText, 
    Mic2, 
    Monitor, 
    Play, 
    Pause, 
    Square, 
    RotateCcw, 
    RotateCw,
    Info,
    Activity,
    Loader2
} from 'lucide-react'

/* ── Types ──────────────────────────────────────────── */

interface HablanteInfo {
    id: string
    speaker_id: string
    rol: string
    etiqueta: string
    nombre: string | null
    color: string
    orden: number
}

interface InferenciaSugerencia {
    speaker_id: string
    rol_sugerido: string
    etiqueta_sugerida: string
    color_sugerido: string
    confianza: number
    razon: string
}

/* ── Component ──────────────────────────────────────── */

export default function PaginaTranscripcion() {
    const params = useParams()
    const router = useRouter()
    const { user } = useAuthStore()
    const audienciaId = params.id as string

    useEffect(() => {
        if (user?.rol === 'admin') router.replace('/admin')
    }, [user, router])

    const [audiencia, setAudiencia] = useState<Audiencia | null>(null)
    const [cargaError, setCargaError] = useState<string | null>(null)
    const [fuenteAudio, setFuenteAudio] = useState<'microphone' | 'system'>('microphone')
    const [mostrarSelector, setMostrarSelector] = useState(true)
    const [isInitializing, setIsInitializing] = useState(false)
    const [pestanaSidebar, setPestanaSidebar] = useState<'hablantes' | 'marcadores' | 'frases' | 'variables'>('hablantes')
    
    // Hablantes State
    const [hablantesData, setHablantesData] = useState<HablanteInfo[]>([])
    const [infiriendoRoles, setInfiriendoRoles] = useState(false)
    const [inferencias, setInferencias] = useState<InferenciaSugerencia[] | null>(null)
    const creandoHablantesRef = useRef<Set<string>>(new Set())

    const {
        segments,
        isTranscribing,
        connectionStatus,
        provisionalSpeaker,
        provisionalText,
        setTranscribing,
        setElapsedSeconds,
        setCurrentAudioTime,
        setConnectionStatus,
        reset,
        varDetecciones,
        removeVarDeteccion,
    } = useCanvasStore()

    const { isConnected, connect, sendAudio, stop, disconnect } = useDeepgramSocket(audienciaId)

    const cargarHablantes = useCallback(async () => {
        try {
            const { data } = await api.get(`/api/audiencias/${audienciaId}/hablantes`)
            setHablantesData(data)
        } catch (err) { console.error(err) }
    }, [audienciaId])

    const speakersDetectados = useMemo(
        () => Array.from(new Set(segments.map(s => s.speaker_id))),
        [segments]
    )

    // Auto-crear hablantes detectados
    useEffect(() => {
        const idsExistentes = hablantesData.map(h => h.speaker_id)
        const nuevos = speakersDetectados.filter(id => !idsExistentes.includes(id) && !creandoHablantesRef.current.has(id))

        if (nuevos.length > 0) {
            nuevos.forEach(id => creandoHablantesRef.current.add(id))
            Promise.all(nuevos.map((speakerId, idx) =>
                api.post(`/api/audiencias/${audienciaId}/hablantes`, {
                    speaker_id: speakerId, rol: 'otro', orden: hablantesData.length + idx,
                }).finally(() => creandoHablantesRef.current.delete(speakerId)).catch(err => {
                    if (err?.response?.status !== 409) throw err
                })
            )).then(() => cargarHablantes())
        }
    }, [speakersDetectados, audienciaId, hablantesData, cargarHablantes])

    const handleHablanteActualizado = useCallback((hablante: HablanteInfo) => {
        setHablantesData(prev => prev.map(h => h.id === hablante.id ? hablante : h))
        useCanvasStore.getState().triggerRefresh()
    }, [])

    const handleInferirRoles = async () => {
        setInfiriendoRoles(true)
        setInferencias(null)
        try {
            const { data } = await api.post<InferenciaSugerencia[]>(`/api/audiencias/${audienciaId}/hablantes/inferir-roles`)
            setInferencias(data)
        } catch (err) { console.error(err) } finally { setInfiriendoRoles(false) }
    }

    const handleAceptarInferencia = async (sug: InferenciaSugerencia) => {
        const h = hablantesData.find(x => x.speaker_id === sug.speaker_id)
        if (!h) return
        try {
            const { data } = await api.put(`/api/audiencias/${audienciaId}/hablantes/${h.id}`, { rol: sug.rol_sugerido })
            handleHablanteActualizado(data)
            setInferencias(prev => prev?.filter(x => x.speaker_id !== sug.speaker_id) || null)
        } catch (err) { console.error(err) }
    }

    const { isCapturing, isPaused, audioLevel, startCapture, pauseCapture, resumeCapture, stopCapture, error: errorAudio } = useAudioCapture({
        onAudioChunk: sendAudio,
        gainValue: fuenteAudio === 'system' ? 18 : 4,
    })

    const canvasRef = useRef<TranscriptionCanvasHandle>(null)
    const reproductorRef = useRef<ReproductorAudioHandle>(null)
    const temporizadorRef = useRef<NodeJS.Timeout | null>(null)
    const prevTranscribingRef = useRef(false)

    useEffect(() => {
        const cargar = async () => {
            try {
                const [resAud, resSegs] = await Promise.all([
                    api.get<Audiencia>(`/api/audiencias/${audienciaId}`),
                    api.get<Segmento[]>(`/api/audiencias/${audienciaId}/segmentos`)
                ])
                setAudiencia(resAud.data)
                useCanvasStore.getState().setSegments(resSegs.data)
                await cargarHablantes()
                if (resAud.data.estado === 'transcrita' || resAud.data.estado === 'finalizada') setMostrarSelector(false)
            } catch (err: any) {
                const s = err?.response?.status
                if (s === 401 || s === 403) router.replace('/login')
                else setCargaError('Error de conexión.')
            }
        }
        cargar()
        return () => { reset(); if (temporizadorRef.current) clearInterval(temporizadorRef.current) }
    }, [audienciaId, router, reset, cargarHablantes])

    // ... Batch logic (mantener igual)
    const handleAceptarBatch = useCallback(async (id: string, accion: 'aceptar' | 'rechazar') => {
        try {
            await api.post(`/api/audiencias/${audienciaId}/segmentos/batch-update`, { decisiones: [{ segment_id: id, accion }] })
            const store = useCanvasStore.getState()
            store.setSegments(store.segments.map(seg => seg.id === id ? { ...seg, texto_mejorado: accion === 'aceptar' ? (seg.texto_batch || seg.texto_mejorado) : seg.texto_mejorado, texto_batch: null } : seg))
        } catch (error) { console.error(error) }
    }, [audienciaId])

    const handleAplicarMultiplesBatch = useCallback(async (decisiones: any) => {
        try {
            await api.post(`/api/audiencias/${audienciaId}/segmentos/batch-update`, { decisiones })
            const { data } = await api.get<Segmento[]>(`/api/audiencias/${audienciaId}/segmentos`)
            useCanvasStore.getState().setSegments(data)
        } catch (error) { console.error(error) }
    }, [audienciaId])

    useEffect(() => {
        if (isTranscribing) {
            temporizadorRef.current = setInterval(() => setElapsedSeconds(useCanvasStore.getState().elapsedSeconds + 1), 1000)
        } else if (temporizadorRef.current) clearInterval(temporizadorRef.current)
        return () => { if (temporizadorRef.current) clearInterval(temporizadorRef.current) }
    }, [isTranscribing, setElapsedSeconds])

    const iniciarTranscripcion = useCallback(async () => {
        setMostrarSelector(false)
        setIsInitializing(true)
        connect()
        setTimeout(async () => {
            await startCapture(fuenteAudio)
            setTranscribing(true)
            setIsInitializing(false)
        }, 500)
    }, [connect, startCapture, fuenteAudio, setTranscribing])

    const pausarTranscripcion = useCallback(() => { pauseCapture(); setTranscribing(false) }, [pauseCapture, setTranscribing])
    const reanudarTranscripcion = useCallback(() => { resumeCapture(); setTranscribing(true) }, [resumeCapture, setTranscribing])
    const detenerTranscripcion = useCallback(() => { stopCapture(); stop(); setTranscribing(false) }, [stopCapture, stop, setTranscribing])

    const handleSeekAudio = useCallback((t: number) => { reproductorRef.current?.seekTo(t); reproductorRef.current?.play() }, [])
    const handleAudioTimeUpdate = useCallback((s: number) => setCurrentAudioTime(s), [setCurrentAudioTime])
    const handleSegmentoEditado = useCallback(async (id: string, texto: string) => {
        try { await api.put(`/api/audiencias/${audienciaId}/segmentos/${id}`, { texto_editado: texto }) } catch (e) {}
    }, [audienciaId])

    if (!audiencia) return (
        <div className="fixed inset-0 flex items-center justify-center bg-[#FDFCFB]">
            {cargaError ? (
                <div className="text-center"><p className="text-sm font-bold text-[#1B3A5C]">{cargaError}</p></div>
            ) : (
                <div className="flex flex-col items-center gap-4"><Loader2 className="w-10 h-10 animate-spin text-[#A68246]" /><p className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40">Cargando...</p></div>
            )}
        </div>
    )

    const audioUrl = audiencia.audio_path ? `${apiBaseUrl()}/api/audiencias/${audienciaId}/audio` : null

    return (
      <AuthGuard>
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#FDFCFB]">
            <header className="flex items-center justify-between px-8 py-4 shrink-0 bg-white border-b border-[#1B3A5C]/5 z-30">
                <div className="flex items-center gap-6 overflow-hidden">
                    <button onClick={() => router.push('/dashboard')} className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1B3A5C]/5 text-[#1B3A5C] hover:bg-[#1B3A5C]/10 transition-all shrink-0"><ChevronLeft className="w-5 h-5" /></button>
                    <div className="overflow-hidden">
                        <div className="flex items-center gap-3">
                            <h1 className="text-sm font-bold text-[#1B3A5C] truncate">{audiencia.expediente}</h1>
                            <span className="px-2 py-0.5 rounded-full bg-[#A68246]/10 text-[#A68246] text-[9px] font-bold uppercase tracking-wider">{audiencia.estado.replace('_', ' ')}</span>
                        </div>
                        <p className="text-[10px] text-[#1B3A5C]/40 uppercase font-bold tracking-widest mt-0.5 truncate">{audiencia.tipo_audiencia} · {audiencia.juzgado}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {connectionStatus !== 'disconnected' && (
                        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1B3A5C]/[0.03] border border-[#1B3A5C]/5">
                            <div className={`w-1.5 h-1.5 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-orange-500'}`} />
                            <span className="text-[9px] font-bold text-[#1B3A5C]/60 uppercase tracking-widest">{connectionStatus === 'connected' ? 'En Línea' : 'Sincronizando...'}</span>
                        </div>
                    )}
                    <button onClick={() => router.push(`/audiencia/${audienciaId}/acta`)} className="btn-primary flex items-center gap-2 !py-2.5 !rounded-xl !text-xs shadow-none"><FileText className="w-4 h-4" /> Redactar Acta</button>
                </div>
            </header>

            <div className="flex flex-col lg:flex-row flex-1 min-h-0">
                <div className="flex-1 flex flex-col min-w-0 bg-[#FDFCFB] overflow-hidden">
                    <AnimatePresence mode="wait">
                        {(mostrarSelector || isInitializing || isTranscribing || isPaused) ? (
                            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="px-8 h-16 flex items-center justify-between bg-white border-b border-[#1B3A5C]/5 shrink-0">
                                {isInitializing && (
                                    <div className="flex items-center gap-3 px-4 py-2 bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10">
                                        <Loader2 className="w-4 h-4 animate-spin text-[#A68246]" /><span className="text-[10px] font-bold text-[#1B3A5C] uppercase tracking-widest">Inicializando Motor...</span>
                                    </div>
                                )}
                                {mostrarSelector && !isTranscribing && !isPaused && !isInitializing && (
                                    <div className="flex items-center gap-4">
                                        <div className="flex bg-[#1B3A5C]/5 p-1 rounded-xl">
                                            {[{ id: 'microphone', icon: <Mic2 className="w-3.5 h-3.5" />, label: 'Micrófono' }, { id: 'system', icon: <Monitor className="w-3.5 h-3.5" />, label: 'Sistema' }].map(src => (
                                                <button key={src.id} onClick={() => setFuenteAudio(src.id as any)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${fuenteAudio === src.id ? 'bg-white text-[#1B3A5C] shadow-sm' : 'text-[#1B3A5C]/40 hover:text-[#1B3A5C]'}`}>{src.icon}{src.label}</button>
                                            ))}
                                        </div>
                                        <button onClick={iniciarTranscripcion} disabled={isInitializing} className="px-6 py-2.5 bg-[#A68246] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-50">Comenzar Captura</button>
                                    </div>
                                )}
                                {(isTranscribing || isPaused) && (
                                    <div className="flex items-center justify-between w-full">
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-3 px-4 py-2 bg-red-50 rounded-xl border border-red-100">
                                                <div className={`w-2 h-2 rounded-full ${isPaused ? 'bg-orange-400' : 'bg-red-500 animate-pulse'}`} /><span className="text-[10px] font-bold text-red-600 uppercase tracking-widest">{isPaused ? 'En Pausa' : 'Capturando Audio'}</span>
                                            </div>
                                            {!isPaused && <div className="flex items-end gap-0.5 h-4 px-2">{[...Array(8)].map((_, i) => (<motion.div key={i} animate={{ height: isCapturing ? [4, 16 * Math.random() + 4, 4] : 4 }} transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.05 }} className="w-1 bg-[#A68246]/40 rounded-full" />))}</div>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={isPaused ? reanudarTranscripcion : pausarTranscripcion} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white border border-[#1B3A5C]/10 text-[#1B3A5C] hover:bg-[#1B3A5C]/5 transition-all">{isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}</button>
                                            <button onClick={detenerTranscripcion} className="px-6 py-2.5 bg-red-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-700 transition-all flex items-center gap-2"><Square className="w-3.5 h-3.5 fill-current" />Finalizar</button>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ) : !isTranscribing && !isPaused && !mostrarSelector && segments.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="px-8 h-12 flex items-center gap-2 bg-white border-b border-[#1B3A5C]/5 shrink-0">
                                <button onClick={() => canvasRef.current?.undo()} className="p-2 text-[#1B3A5C]/40 hover:text-[#1B3A5C] transition-colors"><RotateCcw className="w-4 h-4" /></button>
                                <button onClick={() => canvasRef.current?.redo()} className="p-2 text-[#1B3A5C]/40 hover:text-[#1B3A5C] transition-colors"><RotateCw className="w-4 h-4" /></button>
                                <div className="w-px h-4 bg-[#1B3A5C]/10 mx-2" /><span className="text-[9px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Modo Edición</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="flex-1 relative flex flex-col min-h-0 bg-[#F7F5F2]/30">
                        <RevisionBatchPanel segmentos={segments} onAceptar={handleAceptarBatch} onAplicarBatch={handleAplicarMultiplesBatch} />
                        <div className="flex-1 overflow-hidden relative">
                            <TranscriptionCanvas ref={canvasRef} soloLectura={isTranscribing} hablantes={hablantesData} onSegmentoEditado={handleSegmentoEditado} onSeekAudio={handleSeekAudio} />
                        </div>
                        <BarraEstado />
                    </div>
                </div>

                <aside className="lg:w-[360px] xl:w-[400px] shrink-0 flex flex-col bg-white border-l border-[#1B3A5C]/5 shadow-2xl z-20">
                    <div className="flex border-b border-[#1B3A5C]/5">
                        {[{ id: 'hablantes', label: 'Hablantes' }, { id: 'marcadores', label: 'Marcadores' }, { id: 'frases', label: 'Frases' }, { id: 'variables', label: 'Detección', badge: varDetecciones.length }].map(tab => (
                            <button key={tab.id} onClick={() => setPestanaSidebar(tab.id as any)} className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all relative ${pestanaSidebar === tab.id ? 'text-[#A68246]' : 'text-[#1B3A5C]/30 hover:text-[#1B3A5C]'}`}>
                                {tab.label}{tab.badge ? <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-[#A68246] text-white text-[8px]">{tab.badge}</span> : null}
                                {pestanaSidebar === tab.id && <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#A68246]" />}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <div className="p-6 border-b border-[#1B3A5C]/5 bg-[#1B3A5C]/[0.02]">
                            <ReproductorAudio ref={reproductorRef} audioUrl={audioUrl} onPosicionCambiada={handleAudioTimeUpdate} onTimeUpdate={handleAudioTimeUpdate} />
                        </div>
                        <div className="p-2">
                            {pestanaSidebar === 'hablantes' && (
                                <PanelHablantes
                                    audienciaId={audienciaId}
                                    hablantes={hablantesData}
                                    onHablanteActualizado={handleHablanteActualizado}
                                    hablandoAhora={provisionalSpeaker}
                                    onInferirRoles={handleInferirRoles}
                                    infiriendoRoles={infiriendoRoles}
                                    inferencias={inferencias}
                                    onAceptarInferencia={handleAceptarInferencia}
                                    onDescartarInferencia={(id) => setInferencias(prev => prev?.filter(x => x.speaker_id !== id) || null)}
                                />
                            )}
                            {pestanaSidebar === 'marcadores' && <PanelMarcadores audienciaId={audienciaId} onSeekAudio={handleSeekAudio} />}
                            {pestanaSidebar === 'frases' && <AtajosFrases onInsertarFrase={(t) => canvasRef.current?.insertContent(t)} habilitado={true} />}
                        </div>
                    </div>
                </aside>
            </div>
        </div>
      </AuthGuard>
    )
}
