'use client'

/**
 * Página de transcripción de audiencia — Vista principal del Canvas.
 *
 * Sprint 2 — Layout 72/28:
 * - Izquierda: Canvas TipTap editable + controles + barra de estado
 * - Derecha: Info + Reproductor audio + Panel hablantes/marcadores/frases
 *
 * Wiring:
 * - Audio player → Canvas: highlight del segmento activo
 * - Canvas → Audio player: click en segmento salta al timestamp
 * - PanelHablantes → Canvas: al cambiar rol, etiqueta/color se propagan
 * - AtajosFrases → Canvas: inserción con Ctrl+[0-9]
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

/* ── Types ──────────────────────────────────────────── */

interface HablanteInfo {
    id: string
    speaker_id: string
    rol: string
    etiqueta: string
    nombre: string | null
    color: string
    orden: number
    auto_detectado: boolean
}

/* ── Component ──────────────────────────────────────── */

export default function PaginaTranscripcion() {
    const params = useParams()
    const router = useRouter()
    const { user } = useAuthStore()

    useEffect(() => {
        if (user?.rol === 'admin') {
            router.replace('/admin')
        }
    }, [user, router])

    const audienciaId = params.id as string

    const [audiencia, setAudiencia] = useState<Audiencia | null>(null)
    const [cargaError, setCargaError] = useState<string | null>(null)
    const [fuenteAudio, setFuenteAudio] = useState<'microphone' | 'system'>('microphone')
    const [mostrarSelector, setMostrarSelector] = useState(true)
    const [isInitializing, setIsInitializing] = useState(false)
    const [pestanaSidebar, setPestanaSidebar] = useState<'hablantes' | 'marcadores' | 'frases' | 'variables'>('hablantes')
    const [hablantesData, setHablantesData] = useState<HablanteInfo[]>([])

    const {
        segments,
        isTranscribing,
        connectionStatus,
        provisionalSpeaker,
        setTranscribing,
        setElapsedSeconds,
        setCurrentAudioTime,
        setConnectionStatus,
        reset,
        varDetecciones,
        removeVarDeteccion,
    } = useCanvasStore()

    const { isConnected, connect, sendAudio, stop, disconnect } = useDeepgramSocket(audienciaId)

    /* ── Variables handlers ──────────────────────────── */
    const handleAceptarDeteccion = useCallback(async (det: VariableDeteccion) => {
        if (!audiencia) return
        const { VARIABLES_DEF } = await import('@/lib/variables')
        const varDef = VARIABLES_DEF.find(v => v.key === det.key)
        if (!varDef?.field) { removeVarDeteccion(det.key); return }
        try {
            const { data } = await api.put(`/api/audiencias/${audienciaId}`, {
                [varDef.field]: det.valorDetectado,
            })
            setAudiencia(data)
        } catch (err) {
            console.error('Error guardando variable:', err)
        }
        removeVarDeteccion(det.key)
    }, [audiencia, audienciaId, removeVarDeteccion])
    const { isCapturing, isPaused, startCapture, pauseCapture, resumeCapture, stopCapture, error: errorAudio } = useAudioCapture({
        onAudioChunk: sendAudio,
    })

    const canvasRef = useRef<TranscriptionCanvasHandle>(null)
    const reproductorRef = useRef<ReproductorAudioHandle>(null)
    const temporizadorRef = useRef<NodeJS.Timeout | null>(null)
    const prevTranscribingRef = useRef(false)

    /* ── Load audiencia ─────────────────────────────── */

    useEffect(() => {
        const cargar = async () => {
            try {
                const [resAudiencia, resSegmentos] = await Promise.all([
                    api.get<Audiencia>(`/api/audiencias/${audienciaId}`),
                    api.get<Segmento[]>(`/api/audiencias/${audienciaId}/segmentos`)
                ])
                setAudiencia(resAudiencia.data)
                useCanvasStore.getState().setSegments(resSegmentos.data)
                
                // Ocultar selector solo en estados finales donde no tiene sentido grabar más.
                // Si hay segmentos previos pero el estado sigue siendo activo,
                // mantener el selector visible para poder reanudar la grabación tras un refresco.
                if (resAudiencia.data.estado === 'transcrita' || resAudiencia.data.estado === 'finalizada') {
                    setMostrarSelector(false)
                }
            } catch (err: any) {
                const status = err?.response?.status
                if (status === 401 || status === 403) {
                    router.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)
                } else if (status === 404) {
                    router.replace('/')
                } else {
                    setCargaError('No se pudo conectar con el servidor. Verifica que el backend esté corriendo.')
                }
            }
        }
        cargar()
        return () => {
            reset()
            if (temporizadorRef.current) clearInterval(temporizadorRef.current)
        }
    }, [audienciaId, router, reset])

    /* ── Sprint 8: Revisión de Propuestas y Merge ──── */

    const handleAceptarBatch = useCallback(async (id: string, accion: 'aceptar' | 'rechazar') => {
        try {
            await api.post(`/api/audiencias/${audienciaId}/segmentos/batch-update`, {
                decisiones: [{ segment_id: id, accion }]
            })
            // Actualizar el estado local (CanvasStore) para reflejar que la propuesta desapareció (o se aceptó)
            const store = useCanvasStore.getState()
            const updated = store.segments.map(seg => {
                if (seg.id === id) {
                    return {
                        ...seg,
                        texto_mejorado: accion === 'aceptar' ? (seg.texto_batch || seg.texto_mejorado) : seg.texto_mejorado,
                        texto_batch: null
                    }
                }
                return seg
            })
            store.setSegments(updated)
        } catch (error) {
            console.error('Error aplicando decisión batch:', error)
        }
    }, [audienciaId])

    const handleAplicarMultiplesBatch = useCallback(async (decisiones: Array<{ segment_id: string, accion: string }>) => {
        try {
            await api.post(`/api/audiencias/${audienciaId}/segmentos/batch-update`, {
                decisiones
            })
            
            // Refrescar los segmentos trayéndolos de BD para estar 100% sincronizados
            const resSegmentos = await api.get<Segmento[]>(`/api/audiencias/${audienciaId}/segmentos`)
            useCanvasStore.getState().setSegments(resSegmentos.data)
            
        } catch (error) {
            console.error('Error aplicando decisiones batch múltiples:', error)
        }
    }, [audienciaId])

    /* ── Timer ──────────────────────────────────────── */

    useEffect(() => {
        if (isTranscribing) {
            temporizadorRef.current = setInterval(() => {
                setElapsedSeconds(useCanvasStore.getState().elapsedSeconds + 1)
            }, 1000)
        } else {
            if (temporizadorRef.current) clearInterval(temporizadorRef.current)
        }
        return () => {
            if (temporizadorRef.current) clearInterval(temporizadorRef.current)
        }
    }, [isTranscribing, setElapsedSeconds])

    /* ── Refresh audiencia after transcription stops (to get audio_path) ── */
    // Polls until estado="transcrita" so we know the backend finalized the WAV file.

    useEffect(() => {
        const wasTranscribing = prevTranscribingRef.current
        prevTranscribingRef.current = isTranscribing

        if (!wasTranscribing || isTranscribing || isPaused) return

        let attempts = 0
        let timerId: ReturnType<typeof setTimeout> | null = null

        const poll = async () => {
            attempts++
            try {
                const { data } = await api.get<Audiencia>(`/api/audiencias/${audienciaId}`)
                setAudiencia(data)
                if (data.estado === 'transcrita' || data.estado === 'finalizada') return
            } catch (err) {
                console.error('Error refreshing audiencia after stop:', err)
            }
            if (attempts < 10) {
                timerId = setTimeout(poll, 2000)
            }
        }

        // Primer intento a los 2s
        timerId = setTimeout(poll, 2000)
        return () => { if (timerId) clearTimeout(timerId) }
    }, [isTranscribing, isPaused, audienciaId])

    /* ── Speaker IDs detected ──────────────────────── */

    const speakersDetectados = useMemo(
        () => Array.from(new Set(segments.map(s => s.speaker_id))),
        // Solo recalcular cuando realmente cambia la lista de speaker_ids únicos
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [segments.map(s => s.speaker_id).join(',')]
    )

    /* ── Start/Stop transcription ──────────────────── */

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

    const pausarTranscripcion = useCallback(() => {
        pauseCapture()
        setTranscribing(false)
    }, [pauseCapture, setTranscribing])

    const reanudarTranscripcion = useCallback(() => {
        resumeCapture()
        setTranscribing(true)
    }, [resumeCapture, setTranscribing])

    const detenerTranscripcion = useCallback(() => {
        stopCapture()
        stop()
        setTranscribing(false)
    }, [stopCapture, stop, setTranscribing])

    /* ── Canvas ↔ Audio sync ───────────────────────── */

    // Canvas segment click → seek audio player
    const handleSeekAudio = useCallback((timestamp: number) => {
        reproductorRef.current?.seekTo(timestamp)
        reproductorRef.current?.play()
    }, [])

    // Audio player time update → highlight active segment in canvas
    const handleAudioTimeUpdate = useCallback((segundos: number) => {
        setCurrentAudioTime(segundos)
    }, [setCurrentAudioTime])

    // Debounced segment edit → save to API
    const handleSegmentoEditado = useCallback(async (id: string, texto: string) => {
        try {
            await api.put(`/api/audiencias/${audienciaId}/segmentos/${id}`, {
                texto_editado: texto,
            })
        } catch (error) {
            console.error('Error guardando segmento:', error)
        }
    }, [audienciaId])

    // PanelHablantes update → refresh labels in Canvas via re-render
    const handleHablanteActualizado = useCallback((hablante: HablanteInfo) => {
        setHablantesData(prev => {
            const exists = prev.some(h => h.id === hablante.id)
            if (exists) {
                return prev.map(h => (h.id === hablante.id ? hablante : h))
            }
            // Hablante nuevo — agregarlo a la lista
            return [...prev, hablante]
        })
    }, [])

    // Speaker change in canvas → update segments + merge if adjacent same speaker
    const handleSpeakerCambiado = useCallback(async (firstSegmentId: string, newSpeakerId: string) => {
        const store = useCanvasStore.getState()
        const segs = store.segments

        const startIdx = segs.findIndex(s => s.id === firstSegmentId)
        if (startIdx === -1) return

        const currentSpeakerId = segs[startIdx].speaker_id
        if (currentSpeakerId === newSpeakerId) return

        // Collect the speaker group starting at firstSegmentId
        const groupIds: string[] = []
        for (let i = startIdx; i < segs.length; i++) {
            if (segs[i].speaker_id !== currentSpeakerId) break
            groupIds.push(segs[i].id)
        }

        // Optimistic update in store
        store.updateSegmentsSpeaker(groupIds, newSpeakerId)

        // Update backend
        try {
            await Promise.all(
                groupIds.map(id =>
                    api.put(`/api/audiencias/${audienciaId}/segmentos/${id}`, { speaker_id: newSpeakerId })
                )
            )
        } catch (err) {
            console.error('Error actualizando speaker_id:', err)
            return
        }

        // Check if adjacent groups have the same speaker → merge
        const updatedSegs = useCanvasStore.getState().segments
        const newStartIdx = updatedSegs.findIndex(s => s.id === firstSegmentId)
        if (newStartIdx === -1) return

        // Collect current group again
        const currentGroupIds: string[] = []
        for (let i = newStartIdx; i < updatedSegs.length; i++) {
            if (updatedSegs[i].speaker_id !== newSpeakerId) break
            currentGroupIds.push(updatedSegs[i].id)
        }

        // Check prev segment for same speaker
        const prevIds: string[] = []
        if (newStartIdx > 0 && updatedSegs[newStartIdx - 1].speaker_id === newSpeakerId) {
            const prevSpeaker = newSpeakerId
            for (let i = newStartIdx - 1; i >= 0; i--) {
                if (updatedSegs[i].speaker_id !== prevSpeaker) break
                prevIds.unshift(updatedSegs[i].id)
            }
        }

        // Check next segment for same speaker
        const afterIdx = newStartIdx + currentGroupIds.length
        const nextIds: string[] = []
        if (afterIdx < updatedSegs.length && updatedSegs[afterIdx].speaker_id === newSpeakerId) {
            for (let i = afterIdx; i < updatedSegs.length; i++) {
                if (updatedSegs[i].speaker_id !== newSpeakerId) break
                nextIds.push(updatedSegs[i].id)
            }
        }

        const toMerge = [...prevIds, ...currentGroupIds, ...nextIds]
        if (toMerge.length > 1) {
            try {
                const { data: merged } = await api.post<Segmento>(
                    `/api/audiencias/${audienciaId}/segmentos/merge`,
                    { segment_ids: toMerge }
                )
                store.replaceSegments(toMerge, merged)
            } catch (err) {
                console.error('Error fusionando segmentos:', err)
            }
        }
    }, [audienciaId])

    // Reasignar segmentos seleccionados a un nuevo speaker (desde selection toolbar)
    const handleReasignarSegmentos = useCallback(async (segmentIds: string[], newSpeakerId: string) => {
        const store = useCanvasStore.getState()
        // Optimistic update
        store.updateSegmentsSpeaker(segmentIds, newSpeakerId)
        // Persist to backend
        try {
            await Promise.all(
                segmentIds.map(id =>
                    api.put(`/api/audiencias/${audienciaId}/segmentos/${id}`, { speaker_id: newSpeakerId })
                )
            )
        } catch (err) {
            console.error('Error reasignando segmentos:', err)
            return
        }
        // Detect and merge adjacent same-speaker groups
        const segs = useCanvasStore.getState().segments
        // For each changed segment, check neighbors
        const allToMerge = new Set<string>()
        for (const segId of segmentIds) {
            const idx = segs.findIndex(s => s.id === segId)
            if (idx === -1) continue
            // Collect contiguous block around this segment with same speaker
            const block: string[] = [segId]
            for (let i = idx - 1; i >= 0 && segs[i].speaker_id === newSpeakerId; i--)
                block.unshift(segs[i].id)
            for (let i = idx + 1; i < segs.length && segs[i].speaker_id === newSpeakerId; i++)
                block.push(segs[i].id)
            if (block.length > 1) block.forEach(id => allToMerge.add(id))
        }
        const mergeList = Array.from(allToMerge)
        if (mergeList.length > 1) {
            try {
                const { data: merged } = await api.post<Segmento>(
                    `/api/audiencias/${audienciaId}/segmentos/merge`,
                    { segment_ids: mergeList }
                )
                store.replaceSegments(mergeList, merged)
            } catch (err) {
                console.error('Error fusionando segmentos:', err)
            }
        }
    }, [audienciaId])

    // Undo/Redo via canvas ref
    const handleUndo = useCallback(() => canvasRef.current?.undo(), [])
    const handleRedo = useCallback(() => canvasRef.current?.redo(), [])

    // Insert frase from sidebar
    const insertarFraseEnCanvas = useCallback((texto: string) => {
        canvasRef.current?.insertContent(texto)
    }, [])

    // Bookmark click → seek audio + scroll canvas
    const handleClickMarcador = useCallback((timestamp: number) => {
        reproductorRef.current?.seekTo(timestamp)
        reproductorRef.current?.play()
    }, [])

    /* ── Loading ────────────────────────────────────── */

    if (!audiencia) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
                {cargaError ? (
                    <div className="text-center max-w-sm px-6">
                        <p className="text-sm font-medium mb-2" style={{ color: 'var(--danger)' }}>Error de conexión</p>
                        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{cargaError}</p>
                        <button
                            onClick={() => router.replace('/')}
                            className="text-xs px-4 py-2 rounded-lg"
                            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                        >
                            ← Volver al inicio
                        </button>
                    </div>
                ) : (
                    <div
                        className="w-10 h-10 border-3 rounded-full animate-spin"
                        style={{ borderColor: 'var(--accent-gold)', borderTopColor: 'transparent' }}
                    />
                )}
            </div>
        )
    }

    const audioUrl = audiencia.audio_path
        ? `${apiBaseUrl()}/api/audiencias/${audienciaId}/audio`
        : null

    /* ── Render ──────────────────────────────────────── */

    return (
      <AuthGuard>
        <div className="h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
            {/* ── Header ─────────────────────────────────── */}
            <header
                className="flex items-center justify-between px-4 sm:px-6 py-2 sm:py-3 shrink-0"
                style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
            >
                <div className="flex items-center gap-3 sm:gap-4 overflow-hidden">
                    <button
                        onClick={() => window.location.href = '/'}
                        className="text-[10px] sm:text-xs px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg transition-colors hover:brightness-110 shrink-0"
                        style={{ color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                    >
                        ← <span className="hidden sm:inline">Volver</span>
                    </button>
                    <div className="overflow-hidden">
                        <h1 className="text-xs sm:text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {audiencia.expediente}
                        </h1>
                        <p className="text-[10px] sm:text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                            {audiencia.tipo_audiencia} <span className="hidden sm:inline">— {audiencia.juzgado}</span>
                        </p>
                    </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-2">
                    {/* Connection status — solo visible cuando activo o con error */}
                    {connectionStatus !== 'disconnected' && (
                        <div
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] shrink-0"
                            style={{
                                background: connectionStatus === 'connected' ? 'rgba(34,197,94,0.1)' : 'rgba(249,115,22,0.1)',
                                color: connectionStatus === 'connected' ? '#4ADE80' : '#FB923C',
                            }}
                        >
                            <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: connectionStatus === 'connected' ? '#4ADE80' : '#FB923C' }}
                            />
                            <span className="hidden sm:inline">
                                {connectionStatus === 'connected' ? 'Conectado' : 'Reconectando...'}
                            </span>
                        </div>
                    )}
                    
                    <button
                        onClick={() => window.location.href = `/audiencia/${audienciaId}/acta`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110 shrink-0"
                        style={{
                            background: 'var(--accent-gold)',
                            color: 'white',
                            border: '1px solid transparent',
                        }}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                            <polyline points="10 9 9 9 8 9"/>
                        </svg>
                        <span className="hidden sm:inline">Redactar Acta</span>
                    </button>
                </div>
            </header>

            <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
                {/* ── Canvas (Main Area) ────────────────────────── */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                    {/* Control strip — altura fija para evitar saltos de layout */}
                    {(mostrarSelector || isInitializing || isTranscribing || isPaused) && (
                        <div
                            className="px-4 sm:px-6 shrink-0 flex items-center gap-3"
                            style={{
                                height: '52px',
                                borderBottom: '1px solid var(--border-subtle)',
                                background: 'var(--bg-secondary)',
                            }}
                        >
                            {/* Estado: selector de fuente o conectando */}
                            {(mostrarSelector || isInitializing) && !isTranscribing && !isPaused && (
                                <>
                                    <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                                        Fuente:
                                    </span>
                                    <div className="flex gap-1.5">
                                        {([
                                            { value: 'microphone' as const, icon: (
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                                    <line x1="12" y1="19" x2="12" y2="23"/>
                                                    <line x1="8" y1="23" x2="16" y2="23"/>
                                                </svg>
                                            ), label: 'Micrófono' },
                                            { value: 'system' as const, icon: (
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                                                    <line x1="8" y1="21" x2="16" y2="21"/>
                                                    <line x1="12" y1="17" x2="12" y2="21"/>
                                                </svg>
                                            ), label: 'Sistema' },
                                        ]).map(src => (
                                            <button
                                                key={src.value}
                                                onClick={() => !isInitializing && setFuenteAudio(src.value)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                                                style={{
                                                    background: fuenteAudio === src.value ? 'var(--accent-gold-soft)' : 'var(--bg-surface)',
                                                    border: `1px solid ${fuenteAudio === src.value ? 'rgba(166,130,70,0.35)' : 'var(--border-default)'}`,
                                                    color: fuenteAudio === src.value ? 'var(--accent-gold)' : 'var(--text-secondary)',
                                                    opacity: isInitializing ? 0.5 : 1,
                                                }}
                                            >
                                                {src.icon}
                                                <span className="hidden sm:inline">{src.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={iniciarTranscripcion}
                                        disabled={isInitializing}
                                        className="ml-auto px-5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-70"
                                        style={{
                                            background: 'var(--accent-gold)',
                                            color: 'white',
                                        }}
                                    >
                                        {isInitializing ? 'Conectando...' : 'Iniciar'}
                                    </button>
                                </>
                            )}

                            {/* Estado: grabando o pausado */}
                            {(isTranscribing || isPaused) && (
                                <>
                                    <div className="flex items-center gap-2">
                                        {isPaused ? (
                                            <>
                                                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: '#F59E0B' }} />
                                                <span className="text-xs font-medium" style={{ color: '#F59E0B' }}>Pausado</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: 'var(--danger)' }} />
                                                <span className="text-xs font-medium" style={{ color: 'var(--danger)' }}>Grabando</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 ml-auto">
                                        {isPaused ? (
                                            <button
                                                onClick={reanudarTranscripcion}
                                                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                                style={{
                                                    background: 'rgba(34,197,94,0.12)',
                                                    color: '#22C55E',
                                                    border: '1px solid rgba(34,197,94,0.25)',
                                                }}
                                            >
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                                <span className="hidden sm:inline">Reanudar</span>
                                            </button>
                                        ) : (
                                            <button
                                                onClick={pausarTranscripcion}
                                                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                                style={{
                                                    background: 'rgba(245,158,11,0.12)',
                                                    color: '#F59E0B',
                                                    border: '1px solid rgba(245,158,11,0.25)',
                                                }}
                                            >
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                                                <span className="hidden sm:inline">Pausar</span>
                                            </button>
                                        )}
                                        <button
                                            onClick={detenerTranscripcion}
                                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                            style={{
                                                background: 'rgba(155,34,38,0.1)',
                                                color: 'var(--danger)',
                                                border: '1px solid rgba(155,34,38,0.2)',
                                            }}
                                        >
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                                            <span className="hidden sm:inline">Detener</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Editing toolbar — visible solo en modo edición (transcripción inactiva) */}
                    {!isTranscribing && !isPaused && !mostrarSelector && segments.length > 0 && (
                        <div
                            className="px-4 sm:px-6 shrink-0 flex items-center gap-1"
                            style={{
                                height: '36px',
                                borderBottom: '1px solid var(--border-subtle)',
                                background: 'var(--bg-secondary)',
                            }}
                        >
                            <button
                                onClick={handleUndo}
                                title="Deshacer (Ctrl+Z)"
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-all hover:brightness-110"
                                style={{
                                    background: 'var(--bg-surface)',
                                    border: '1px solid var(--border-subtle)',
                                    color: 'var(--text-secondary)',
                                }}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                                </svg>
                                <span className="hidden sm:inline">Deshacer</span>
                            </button>
                            <button
                                onClick={handleRedo}
                                title="Rehacer (Ctrl+Shift+Z)"
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-all hover:brightness-110"
                                style={{
                                    background: 'var(--bg-surface)',
                                    border: '1px solid var(--border-subtle)',
                                    color: 'var(--text-secondary)',
                                }}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
                                </svg>
                                <span className="hidden sm:inline">Rehacer</span>
                            </button>
                        </div>
                    )}

                    {/* Canvas TipTap */}
                    <div className="flex-1 relative flex flex-col min-h-0">
                        <RevisionBatchPanel
                            segmentos={segments}
                            onAceptar={handleAceptarBatch}
                            onAplicarBatch={handleAplicarMultiplesBatch}
                        />
                        <TranscriptionCanvas
                            ref={canvasRef}
                            soloLectura={isTranscribing}
                            hablantes={hablantesData}
                            onSegmentoEditado={handleSegmentoEditado}
                            onSeekAudio={handleSeekAudio}
                            onSpeakerCambiado={handleSpeakerCambiado}
                            onReasignarSegmentos={handleReasignarSegmentos}
                        />
                    </div>

                    {/* Status bar - Hidden or simplified on mobile */}
                    <div className="hidden sm:block">
                        <BarraEstado />
                    </div>
                </div>

                {/* ── Sidebar (Right on desktop, Bottom/Toggle on mobile) ──────────────────────────── */}
                <aside
                    className="lg:w-[320px] xl:w-[380px] shrink-0 flex flex-col overflow-hidden border-t lg:border-t-0 lg:border-l h-[300px] lg:h-full"
                    style={{
                        borderLeft: '1px solid var(--border-subtle)',
                        background: 'var(--bg-secondary)',
                    }}
                >
                    {/* Tabs */}
                    <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {([
                            { id: 'hablantes' as const, label: 'Hablantes' },
                            { id: 'marcadores' as const, label: 'Marcadores' },
                            { id: 'frases' as const, label: 'Frases' },
                            { id: 'variables' as const, label: 'Variables', badge: varDetecciones.length > 0 ? varDetecciones.length : null },
                        ]).map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setPestanaSidebar(tab.id)}
                                className="flex-1 flex items-center justify-center gap-1 py-2.5 text-[9px] sm:text-[10px] font-medium uppercase tracking-wider transition-colors"
                                style={{
                                    color: pestanaSidebar === tab.id ? 'var(--accent-gold)' : 'var(--text-muted)',
                                    borderBottom: pestanaSidebar === tab.id ? '2px solid var(--accent-gold)' : '2px solid transparent',
                                }}
                            >
                                {tab.label}
                                {tab.badge && (
                                    <span
                                        className="w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center"
                                        style={{ background: 'var(--accent-gold)', color: 'white' }}
                                    >
                                        {tab.badge}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Sidebar content */}
                    <div className="flex-1 overflow-y-auto">
                        {/* Audiencia info (always visible) */}
                        <div className="p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <h3
                                className="text-xs font-semibold uppercase tracking-wider mb-2"
                                style={{ color: 'var(--accent-gold)' }}
                            >
                                Información
                            </h3>
                            <div className="space-y-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                <div className="flex justify-between">
                                    <span style={{ color: 'var(--text-muted)' }}>Expediente</span>
                                    <span className="font-medium">{audiencia.expediente}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span style={{ color: 'var(--text-muted)' }}>Tipo</span>
                                    <span>{audiencia.tipo_audiencia}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span style={{ color: 'var(--text-muted)' }}>Fecha</span>
                                    <span>{audiencia.fecha}</span>
                                </div>
                                {audiencia.delito && (
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--text-muted)' }}>Delito</span>
                                        <span>{audiencia.delito}</span>
                                    </div>
                                )}
                                {audiencia.imputado_nombre && (
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--text-muted)' }}>Imputado</span>
                                        <span>{audiencia.imputado_nombre}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Audio player (always visible) */}
                        <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <ReproductorAudio
                                ref={reproductorRef}
                                audioUrl={audioUrl}
                                onPosicionCambiada={handleAudioTimeUpdate}
                                onTimeUpdate={handleAudioTimeUpdate}
                            />
                        </div>

                        {/* Active panel */}
                        {pestanaSidebar === 'hablantes' && (
                            <PanelHablantes
                                audienciaId={audienciaId}
                                speakersDetectados={speakersDetectados}
                                onHablanteActualizado={handleHablanteActualizado}
                                onHablantesCargados={setHablantesData}
                                hablandoAhora={provisionalSpeaker}
                            />
                        )}
                        {pestanaSidebar === 'marcadores' && (
                            <PanelMarcadores
                                audienciaId={audienciaId}
                                onSeekAudio={handleClickMarcador}
                            />
                        )}
                        {pestanaSidebar === 'frases' && (
                            <AtajosFrases
                                onInsertarFrase={insertarFraseEnCanvas}
                                habilitado={true}
                            />
                        )}
                        {pestanaSidebar === 'variables' && audiencia && (
                            <PanelVariables
                                audiencia={audiencia}
                                hablantes={hablantesData}
                                detecciones={varDetecciones}
                                onAceptarDeteccion={handleAceptarDeteccion}
                                onRechazarDeteccion={removeVarDeteccion}
                                onAudienciaActualizada={(campos) => setAudiencia(prev => prev ? { ...prev, ...campos } : prev)}
                            />
                        )}
                    </div>
                </aside>
            </div>
        </div>
      </AuthGuard>
    )
}
