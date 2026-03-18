'use client'

/**
 * Página Demo del Canvas — transcripción directa sin crear audiencia.
 * 
 * Sprint 2: Usa TranscriptionCanvas TipTap + paneles laterales
 * en layout 72/28, con aspecto Word-like.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAudioCapture } from '@/hooks/useAudioCapture'
import { useDeepgramSocket } from '@/hooks/useDeepgramSocket'
import TranscriptionCanvas, { TranscriptionCanvasHandle } from '@/components/canvas/TranscriptionCanvas'
import ReproductorAudio, { ReproductorAudioHandle } from '@/components/audio/ReproductorAudio'
import PanelHablantes from '@/components/speakers/PanelHablantes'
import BarraEstado from '@/components/status/BarraEstado'
import AtajosFrases from '@/components/shortcuts/AtajosFrases'
import PanelMarcadores from '@/components/markers/PanelMarcadores'
import DictionaryPanel from '@/components/dictionary/DictionaryPanel'
import type { DictionarySuggestion } from '@/components/canvas/SuggestionPopover'

const DEMO_ID = '00000000-0000-0000-0000-000000000000'

/* ── Speaker colors ─────────────────── */
const SPEAKER_COLORS = [
    '#2563EB', '#059669', '#DC2626', '#D97706',
    '#7C3AED', '#0891B2', '#4F46E5', '#BE185D',
]

const speakerColor = (id: string) => {
    const idx = parseInt(id.replace(/\D/g, ''), 10) || 0
    return SPEAKER_COLORS[idx % SPEAKER_COLORS.length]
}

export default function DemoCanvasPage() {
    const router = useRouter()
    const [fuenteAudio, setFuenteAudio] = useState<'microphone' | 'system'>('microphone')
    const [audioUrl, setAudioUrl] = useState<string | null>(null)

    const canvasRef = useRef<TranscriptionCanvasHandle>(null)
    const audioPlayerRef = useRef<ReproductorAudioHandle>(null)

    const {
        segments,
        isTranscribing,
        connectionStatus,
        elapsedSeconds,
        provisionalSpeaker,
        setTranscribing,
        setElapsedSeconds,
        setCurrentAudioTime,
        reset,
    } = useCanvasStore()

    const { isConnected, connect, sendAudio, stop, disconnect, error: wsError, suggestions: wsSuggestions } = useDeepgramSocket(DEMO_ID)

    const { isCapturing, startCapture, stopCapture, error: audioError } = useAudioCapture({
        onAudioChunk: sendAudio,
    })

    const temporizadorRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Build hablantes list from detected speakers
    const hablantes = Array.from(new Set(segments.map(s => s.speaker_id))).map((spk, i) => ({
        speaker_id: spk,
        etiqueta: spk,
        color: speakerColor(spk),
        nombre: null,
    }))

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            reset()
            if (temporizadorRef.current) clearInterval(temporizadorRef.current)
        }
    }, [reset])

    // Timer
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

    const iniciarTranscripcion = useCallback(async () => {
        connect()
        setTimeout(async () => {
            await startCapture(fuenteAudio)
            setTranscribing(true)
        }, 500)
    }, [connect, startCapture, fuenteAudio, setTranscribing])

    const detenerTranscripcion = useCallback(() => {
        stopCapture()
        stop()
        setTranscribing(false)
    }, [stopCapture, stop, setTranscribing])

    // Audio player → Canvas sync
    const handleAudioTimeUpdate = useCallback((seconds: number) => {
        setCurrentAudioTime(seconds)
    }, [setCurrentAudioTime])

    // Canvas → Audio player seek
    const handleSeekAudio = useCallback((timestamp: number) => {
        audioPlayerRef.current?.seekTo(timestamp)
        audioPlayerRef.current?.play()
    }, [])

    // Canvas → API save (noop for demo)
    const handleSegmentoEditado = useCallback((segmentoId: string, textoNuevo: string) => {
        // In demo mode we just update the store (no API)
        useCanvasStore.getState().updateSegment(segmentoId, textoNuevo)
    }, [])

    // Phrase shortcut → insert into Canvas
    const handleInsertarFrase = useCallback((texto: string) => {
        canvasRef.current?.insertContent(texto)
    }, [])

    // Dictionary suggestions mapped for the panel
    const [dictSuggestions, setDictSuggestions] = useState<DictionarySuggestion[]>([])

    // Transform incoming WS suggestions to DictionarySuggestion format
    useEffect(() => {
        if (wsSuggestions.length > dictSuggestions.length) {
            const newOnes = wsSuggestions.slice(dictSuggestions.length).map((s, i) => ({
                id: `sug-${Date.now()}-${i}`,
                segmentOrder: s.segment_order,
                originalWord: s.original_word,
                suggestedWord: s.suggested_word,
                confidence: s.confidence,
                category: s.category,
                context: '',
                position: s.position,
                status: 'pending' as const,
            }))
            setDictSuggestions(prev => [...prev, ...newOnes])
        }
    }, [wsSuggestions])

    const handleAcceptSuggestion = useCallback((s: DictionarySuggestion) => {
        setDictSuggestions(prev => prev.map(sug => sug.id === s.id ? { ...sug, status: 'accepted' as const } : sug))
        // In a real implementation, apply the replacement to the Canvas
    }, [])

    const handleRejectSuggestion = useCallback((s: DictionarySuggestion) => {
        setDictSuggestions(prev => prev.map(sug => sug.id === s.id ? { ...sug, status: 'rejected' as const } : sug))
    }, [])

    return (
        <div className="h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
            {/* ── Header ──────────────────────────── */}
            <header className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 shrink-0 gap-4"
                style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-secondary)' }}>
                <div className="flex items-center gap-5 w-full sm:w-auto">
                    <button onClick={() => window.location.href = '/'} className="btn-secondary text-[10px] shrink-0">
                        ← Volver
                    </button>
                    <div className="overflow-hidden">
                        <h1 className="text-sm font-bold truncate tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                            DEMO: TRANSCRIPCIÓN JUDICIAL
                        </h1>
                        <p className="text-[10px] font-medium uppercase tracking-[0.15em] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            Novum Nova-3 · 100+ Keyterms
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
                    <div className={`connection-indicator ${connectionStatus === 'connected' ? 'connection-indicator--connected' : 'connection-indicator--disconnected'}`}>
                        <span className="connection-indicator__dot" />
                        {connectionStatus === 'connected' ? 'Sistema en Línea' : 'Fuera de Línea'}
                    </div>
                </div>
            </header>

            {/* ── Controls ──────────────────────────── */}
            {!isTranscribing ? (
                <div className="px-6 py-4 flex flex-col md:flex-row items-start md:items-center gap-6 shrink-0"
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-primary)' }}>
                    <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Entrada:</span>
                        <div className="flex gap-2">
                            {[
                                { value: 'microphone' as const, label: 'Micrófono', desc: 'Directo' },
                                { value: 'system' as const, label: 'Sistema', desc: 'Virtual' },
                            ].map((src) => (
                                <button key={src.value}
                                    onClick={() => setFuenteAudio(src.value)}
                                    className="px-5 py-2.5 rounded-[1px] text-[11px] font-bold uppercase tracking-wide transition-all"
                                    style={{
                                        background: fuenteAudio === src.value ? 'var(--text-primary)' : 'var(--bg-surface)',
                                        border: `1px solid ${fuenteAudio === src.value ? 'var(--text-primary)' : 'var(--border-default)'}`,
                                        color: fuenteAudio === src.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
                                    }}>
                                    {src.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button onClick={iniciarTranscripcion} className="w-full md:w-auto md:ml-auto btn-primary">
                        Iniciar Sesión de Transcripción
                    </button>
                </div>
            ) : (
                <div className="px-6 py-3 flex items-center justify-between gap-4 shrink-0"
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-primary)' }}>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-3 py-1 bg-[#9B2226]/10 border border-[#9B2226]/20">
                            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--danger)' }} />
                            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--danger)' }}>Grabando en Vivo</span>
                        </div>
                    </div>
                    <button onClick={detenerTranscripcion}
                        className="btn-secondary"
                        style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}>
                        Cerrar Sesión
                    </button>
                </div>
            )}

            {/* Errors */}
            {(wsError || audioError) && (
                <div className="px-6 py-2 text-[11px] font-bold uppercase tracking-wide flex items-center gap-2"
                    style={{ background: 'rgba(155, 34, 38, 0.05)', color: 'var(--danger)', borderBottom: '1px solid rgba(155, 34, 38, 0.1)' }}>
                    <span className="p-1 px-2 bg-red-800 text-white rounded-[1px]">ALERTA:</span> {wsError || audioError}
                </div>
            )}

            {/* ── Main content: 72/28 layout ──────────── */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                {/* LEFT: Canvas (72%) */}
                <div className="flex-1 lg:w-[72%] flex flex-col min-w-0">
                    {segments.length === 0 && !isTranscribing ? (
                        /* Empty state */
                        <div className="canvas-page-area">
                            <div className="canvas-document">
                                <div className="canvas-document__header">
                                    <div className="canvas-document__title">Acta de Audiencia Virtual</div>
                                    <div className="canvas-document__meta">
                                        <span>Corte Superior de Justicia</span>
                                        <span>DEMO_SESSION_01</span>
                                        <span>{new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase()}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-center justify-center text-center" style={{ flex: 1, padding: '80px 48px' }}>
                                    <div className="empty-state-lines mb-8 scale-125 opacity-40">
                                        <span className="bg-[#A68246]"></span>
                                        <span className="bg-[#A68246]"></span>
                                        <span className="bg-[#A68246]"></span>
                                    </div>
                                    <p className="text-xl font-bold mb-3 tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                                        Prepare el Registro de la Audiencia
                                    </p>
                                    <p className="max-w-md text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                        El sistema generará el registro oficial en formato de acta judicial utilizando el modelo de lenguaje Novum-3 para máxima precisión jurídica.
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Active canvas */
                        <div className="flex-1 overflow-hidden relative">
                            <TranscriptionCanvas
                                ref={canvasRef}
                                soloLectura={false}
                                hablantes={hablantes}
                                onSegmentoEditado={handleSegmentoEditado}
                                onSeekAudio={handleSeekAudio}
                                documentInfo={{
                                    tipo: 'Acta de Audiencia — Registro Demo',
                                    juzgado: 'Juzgado Penal Unipersonal de Cusco',
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* RIGHT: Panels (28%) */}
                <aside className="lg:w-[28%] flex flex-col overflow-y-auto border-t lg:border-t-0 lg:border-l"
                    style={{
                        borderColor: 'var(--border-default)',
                        background: 'var(--bg-secondary)',
                    }}>
                    {/* Audio player */}
                    <div className="p-2">
                        <ReproductorAudio
                            ref={audioPlayerRef}
                            audioUrl={audioUrl}
                            onTimeUpdate={handleAudioTimeUpdate}
                        />
                    </div>

                    <div className="h-px bg-white/10 mx-4" />

                    {/* Speakers panel */}
                    <PanelHablantes
                        audienciaId={DEMO_ID}
                        speakersDetectados={[]}
                        modoDemo={true}
                        hablantesIniciales={hablantes.map((h, i) => ({
                            id: `demo-${i}`,
                            speaker_id: h.speaker_id,
                            rol: 'participante',
                            etiqueta: h.etiqueta,
                            nombre: null,
                            color: h.color,
                            orden: i,
                            auto_detectado: true,
                        }))}
                        onHablanteActualizado={() => { }}
                        onHablantesCargados={() => { }}
                        hablandoAhora={provisionalSpeaker}
                    />

                    <div className="h-px bg-white/10 mx-4" />

                    {/* Phrase shortcuts */}
                    <AtajosFrases
                        onInsertarFrase={handleInsertarFrase}
                        modoDemo={true}
                        frasesIniciales={[
                            { id: '1', numero_atajo: 1, codigo: 'INST', texto: 'Se da por instalada la audiencia.', categoria: 'Apertura' },
                            { id: '2', numero_atajo: 2, codigo: 'TRAS', texto: 'Se corre traslado a las partes.', categoria: 'Debate' },
                            { id: '3', numero_atajo: 3, codigo: 'MINP', texto: 'Se concede el uso de la palabra al Ministerio Público.', categoria: 'Intervención' },
                            { id: '4', numero_atajo: 4, codigo: 'DEF', texto: 'Se concede el uso de la palabra a la Defensa Técnica.', categoria: 'Intervención' },
                            { id: '5', numero_atajo: 5, codigo: 'CONC', texto: 'Se da por concluida la presente audiencia siendo las {HORA}.', categoria: 'Cierre' },
                        ]}
                    />

                    <div className="h-px bg-white/10 mx-4" />

                    {/* Bookmarks */}
                    <PanelMarcadores
                        audienciaId={DEMO_ID}
                        onSeekAudio={handleSeekAudio}
                    />

                    <div className="h-px bg-white/10 mx-4" />

                    {/* Legal Dictionary */}
                    <DictionaryPanel
                        suggestions={dictSuggestions}
                        onAcceptSuggestion={handleAcceptSuggestion}
                        onRejectSuggestion={handleRejectSuggestion}
                    />
                </aside>
            </div>

            {/* ── Status bar ──────────────────────────── */}
            <div className="hidden sm:block">
                <BarraEstado />
            </div>
        </div>
    )
}
