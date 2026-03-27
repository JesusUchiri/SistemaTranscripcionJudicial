'use client'

/**
 * AudioEditorPre — Editor de audio profesional pre-transcripción.
 *
 * Layout 2 columnas:
 *   Izquierda (flex-1): waveform tall + transport + lista de regiones
 *   Derecha   (320px):  modo selector + filtros + botón transcribir
 *
 * WaveSurfer v7 correctamente inicializado:
 *   - plugins registrados en constructor (API v7)
 *   - enableDragSelection dentro de useEffect [mode, ready]
 *   - ZoomPlugin controlado via ws.zoom(n)
 *
 * Atajos: Espacio = play/pausa · ← → = ±5s · Delete = borrar región activa
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import api from '@/lib/api'

/* ── Types ────────────────────────────────────────────────────────────────── */

interface Region { id: string; start: number; end: number; wsRegion?: any }
interface Filters { noise_reduction: boolean; normalize: boolean; volume: number; highpass: boolean }

export interface ProcesarResult {
    audiencia_id: string; expediente: string; estado: string
    total_segmentos: number; duracion_segundos: number; hablantes_detectados: number; mensaje: string
    costo_total_usd: number
}

interface Props {
    audienciaId: string
    duracion: number
    filename?: string
    onProcesado: (r: ProcesarResult) => void
    onCancelar: () => void
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmt(s: number): string {
    if (!isFinite(s) || s < 0) return '0:00'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`
}

function parseTime(v: string): number | null {
    const parts = v.trim().split(':').map(Number)
    if (parts.some(isNaN)) return null
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return parts[0]
}

/* ── Iconos ───────────────────────────────────────────────────────────────── */

const IconPlay = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
)
const IconPause = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
    </svg>
)
const IconZoomIn = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
    </svg>
)
const IconZoomOut = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
)
const IconTrash = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
        <path d="M9 6V4h6v2" />
    </svg>
)
const IconCut = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
)

/* ── Component ────────────────────────────────────────────────────────────── */

export default function AudioEditorPre({ audienciaId, duracion, filename, onProcesado, onCancelar }: Props) {
    const waveRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<any>(null)
    const regPluginRef = useRef<any>(null)
    const mediaElRef = useRef<HTMLAudioElement | null>(null)
    const activeRegionRef = useRef<any>(null)

    const [ready, setReady] = useState(false)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [playing, setPlaying] = useState(false)
    const [time, setTime] = useState(0)
    const [duration, setDuration] = useState(duracion)
    const [zoom, setZoom] = useState(30)

    const [mode, setMode] = useState<'todo' | 'regiones'>('todo')
    const [regions, setRegions] = useState<Region[]>([])
    const [activeId, setActiveId] = useState<string | null>(null)

    const [manualS, setManualS] = useState('')
    const [manualE, setManualE] = useState('')
    const [manualErr, setManualErr] = useState<string | null>(null)

    const [filters, setFilters] = useState<Filters>({
        noise_reduction: false, normalize: false, volume: 1.0, highpass: false,
    })

    const [processing, setProcessing] = useState(false)
    const [progress, setProgress] = useState(0)
    const [procError, setProcError] = useState<string | null>(null)

    const audioUrl = `/api/audiencias/${audienciaId}/audio`

    // ── Inicializar WaveSurfer ──────────────────────────────────────────────
    useEffect(() => {
        if (!waveRef.current) return
        let ws: any
        let dead = false

        const init = async () => {
            setLoading(true)
            setLoadError(null)

            const token = localStorage.getItem('access_token') ?? ''

            const { default: WaveSurfer } = await import('wavesurfer.js')
            const { default: Regions } = await import('wavesurfer.js/dist/plugins/regions.esm.js')
            const { default: Timeline } = await import('wavesurfer.js/dist/plugins/timeline.esm.js')
            const { default: Zoom } = await import('wavesurfer.js/dist/plugins/zoom.esm.js')

            if (dead || !waveRef.current) return

            // HTMLAudioElement con token en query param: streaming nativo del browser
            // sin descargar ni decodificar el archivo completo (crítico para archivos >100MB)
            const mediaEl = document.createElement('audio')
            mediaEl.preload = 'none'
            mediaEl.src = `${audioUrl}?t=${encodeURIComponent(token)}`
            mediaElRef.current = mediaEl

            const regPlugin = Regions.create()
            regPluginRef.current = regPlugin

            ws = WaveSurfer.create({
                container: waveRef.current,
                waveColor: 'rgba(37,99,235,0.22)',
                progressColor: '#2563eb',
                cursorColor: '#1d4ed8',
                cursorWidth: 2,
                barWidth: 2, barGap: 1, barRadius: 3,
                height: 130,
                normalize: true,
                autoScroll: true,
                autoCenter: true,
                hideScrollbar: false,
                media: mediaEl,
                peaks: [new Float32Array(2000).fill(0.5)],
                duration: duracion || undefined,
                plugins: [
                    regPlugin,
                    Timeline.create({
                        height: 22,
                        timeInterval: 5,
                        primaryLabelInterval: 30,
                        style: { fontSize: '10px', color: '#9ca3af' },
                    }),
                    Zoom.create({ scale: 0.5, maxZoom: 600 }),
                ],
            })
            wsRef.current = ws

            ws.on('ready', () => {
                if (dead) return
                setDuration(ws.getDuration())
                setReady(true)
                setLoading(false)
            })
            ws.on('error', (err: any) => {
                if (!dead) { setLoadError(`Error al decodificar: ${err?.message ?? String(err)}`); setLoading(false) }
            })
            ws.on('audioprocess', (t: number) => { if (!dead) setTime(t) })
            ws.on('seek', () => { if (!dead && wsRef.current) setTime(wsRef.current.getCurrentTime()) })
            ws.on('play', () => { if (!dead) setPlaying(true) })
            ws.on('pause', () => { if (!dead) setPlaying(false) })
            ws.on('finish', () => { if (!dead) setPlaying(false) })

            regPlugin.on('region-created', (r: any) => {
                if (dead) return
                // Estilo visual de la región
                r.setOptions({ color: 'rgba(37,99,235,0.15)', drag: true, resize: true })
                activeRegionRef.current = r
                setActiveId(r.id)
                setRegions(prev => prev.find(x => x.id === r.id) ? prev : [...prev, { id: r.id, start: r.start, end: r.end, wsRegion: r }])
            })
            regPlugin.on('region-updated', (r: any) => {
                if (!dead) setRegions(prev => prev.map(x => x.id === r.id ? { ...x, start: r.start, end: r.end } : x))
            })
            regPlugin.on('region-clicked', (r: any, e: MouseEvent) => {
                e.stopPropagation()
                activeRegionRef.current = r
                setActiveId(r.id)
            })
            regPlugin.on('region-double-clicked', (r: any, e: MouseEvent) => {
                e.stopPropagation()
                r.play()
            })

        }

        init()
        return () => {
            dead = true
            wsRef.current?.destroy()
            wsRef.current = null
            regPluginRef.current = null
            if (mediaElRef.current) { mediaElRef.current.src = ''; mediaElRef.current = null }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl])

    useEffect(() => {
        if (ready && wsRef.current) wsRef.current.zoom(zoom)
    }, [zoom, ready])

    useEffect(() => {
        const p = regPluginRef.current
        if (!p || !ready) return
        if (mode === 'regiones') {
            p.enableDragSelection({ color: 'rgba(37,99,235,0.15)' })
        } else {
            p.disableDragSelection?.()
            clearRegions()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, ready])

    // ── Atajos ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA') return
            const ws = wsRef.current
            if (!ws || !ready) return
            if (e.code === 'Space') { e.preventDefault(); ws.playPause() }
            else if (e.code === 'ArrowLeft') { e.preventDefault(); ws.setTime(Math.max(0, ws.getCurrentTime() - 5)) }
            else if (e.code === 'ArrowRight') { e.preventDefault(); ws.setTime(Math.min(duration, ws.getCurrentTime() + 5)) }
            else if ((e.code === 'Delete' || e.code === 'Backspace') && activeRegionRef.current) {
                e.preventDefault(); removeRegion(activeRegionRef.current.id)
            }
        }
        window.addEventListener('keydown', h)
        return () => window.removeEventListener('keydown', h)
    }, [ready, duration]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Regiones ───────────────────────────────────────────────────────────
    const clearRegions = useCallback(() => {
        const p = regPluginRef.current
        if (p) { const all: any[] = p.getRegions?.() ?? []; all.forEach((r: any) => r.remove()) }
        setRegions([])
        setActiveId(null)
        activeRegionRef.current = null
    }, [])

    const removeRegion = useCallback((id: string) => {
        const p = regPluginRef.current
        if (p) { const all: any[] = p.getRegions?.() ?? []; all.find((r: any) => r.id === id)?.remove() }
        setRegions(prev => prev.filter(r => r.id !== id))
        if (activeRegionRef.current?.id === id) { activeRegionRef.current = null; setActiveId(null) }
    }, [])

    const addManual = useCallback(() => {
        setManualErr(null)
        const s = parseTime(manualS)
        const e = parseTime(manualE)
        if (s === null || e === null) { setManualErr('Formato inválido — usa mm:ss'); return }
        if (s >= e) { setManualErr('Inicio debe ser menor que fin'); return }
        if (e > duration) { setManualErr(`El fin excede la duración (${fmt(duration)})`); return }
        regPluginRef.current?.addRegion({ start: s, end: e, color: 'rgba(37,99,235,0.15)', drag: true, resize: true })
        setManualS('')
        setManualE('')
    }, [manualS, manualE, duration])

    // ── Procesar ───────────────────────────────────────────────────────────
    const handleProcess = async () => {
        setProcessing(true)
        setProcError(null)
        setProgress(5)
        let p = 5
        const iv = setInterval(() => {
            p = Math.min(p + (p < 60 ? 1.2 : p < 85 ? 0.4 : 0.1), 92)
            setProgress(Math.round(p))
        }, 2000)
        try {
            // El endpoint devuelve 202 inmediatamente y procesa en background
            await api.post(
                '/api/transcripcion-audio/procesar',
                {
                    audiencia_id: audienciaId,
                    regions: mode === 'regiones' ? regions.map(r => ({ start: r.start, end: r.end })) : [],
                    filters,
                },
                { timeout: 30_000 },
            )

            // Polling: esperar hasta que estado sea 'transcrita' o 'error'
            const MAX_WAIT_MS = 30 * 60 * 1000  // 30 min máximo
            const POLL_INTERVAL = 4_000
            const start = Date.now()

            await new Promise<void>((resolve, reject) => {
                const poll = setInterval(async () => {
                    try {
                        const { data: audiencia } = await api.get(`/api/audiencias/${audienciaId}`)
                        if (audiencia.estado === 'transcrita') {
                            clearInterval(poll)
                            resolve()
                        } else if (audiencia.estado === 'pendiente' && Date.now() - start > 10_000) {
                            // Volvió a 'pendiente' tras >10s = error en background
                            clearInterval(poll)
                            reject(new Error('La transcripción falló. Intenta de nuevo.'))
                        } else if (Date.now() - start > MAX_WAIT_MS) {
                            clearInterval(poll)
                            reject(new Error('Tiempo de espera agotado (30 min). Intenta de nuevo.'))
                        }
                    } catch (pollErr: any) {
                        // Error de red — seguir intentando
                        if (Date.now() - start > MAX_WAIT_MS) {
                            clearInterval(poll)
                            reject(pollErr)
                        }
                    }
                }, POLL_INTERVAL)
            })

            // Obtener datos finales de la audiencia
            const { data: final } = await api.get(`/api/audiencias/${audienciaId}`)
            clearInterval(iv)
            setProgress(100)
            setTimeout(() => onProcesado({
                audiencia_id: audienciaId,
                expediente: final.expediente ?? '',
                estado: final.estado,
                total_segmentos: final.total_segmentos ?? 0,
                duracion_segundos: final.audio_duration_seconds ?? 0,
                hablantes_detectados: 0,
                costo_total_usd: 0,
                mensaje: `Audio transcrito. ${final.total_segmentos ?? 0} segmentos generados.`,
            }), 400)
        } catch (err: any) {
            clearInterval(iv)
            setProcError(err.response?.data?.detail || err.message || 'Error al procesar.')
            setProcessing(false)
            setProgress(0)
        }
    }

    const totalSel = regions.reduce((s, r) => s + r.end - r.start, 0)
    const canProcess = ready && !processing && (mode === 'todo' || regions.length > 0)
    const pct = duration > 0 ? (time / duration) * 100 : 0

    /* ── Error carga ─────────────────────────────────────────────────────── */
    if (loadError) {
        return (
            <div style={{ textAlign: 'center', padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(220,38,38,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                </div>
                <p style={{ fontSize: 14, color: '#dc2626' }}>{loadError}</p>
                <button onClick={onCancelar} className="btn-secondary">Volver</button>
            </div>
        )
    }

    /* ── Render 2-columnas ───────────────────────────────────────────────── */
    return (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

            {/* ══ COLUMNA IZQUIERDA: waveform + controles + regiones ══ */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Waveform — SIN overflow:hidden para que el scroll interno de WaveSurfer sea visible */}
                <div style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 14,
                }}>
                    {/* Info bar superior */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 16px 0', gap: 8,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <div style={{
                                width: 28, height: 28, borderRadius: 7,
                                background: 'rgba(37,99,235,0.1)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: 'var(--accent-primary)', flexShrink: 0,
                            }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                </svg>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                                {filename ?? 'audio'}
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {mode === 'regiones' && ready && (
                                <span style={{
                                    fontSize: 10, padding: '2px 8px', borderRadius: 5,
                                    background: 'rgba(37,99,235,0.12)', color: 'var(--accent-primary)',
                                }}>
                                    Arrastra para seleccionar · Doble clic = reproducir
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Canvas WaveSurfer
                        - padding 0 en los lados: WaveSurfer necesita el ancho completo del contenedor
                        - overflow visible: el scroll horizontal interno de WaveSurfer debe poder mostrarse
                        - padding-bottom: espacio para el scrollbar nativo (≈16px) sin solapar controles
                    */}
                    <div style={{ padding: '8px 0 0', position: 'relative', overflow: 'visible' }}>
                        <div ref={waveRef} style={{
                            minHeight: 152,
                            display: loading ? 'none' : 'block',
                            // Padding-bottom para que el scrollbar no solape el timeline
                            paddingBottom: 4,
                        }} />
                        {loading && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 152 }}>
                                <span style={{
                                    width: 18, height: 18, borderRadius: '50%', display: 'inline-block',
                                    border: '2px solid var(--accent-primary)', borderTopColor: 'transparent',
                                    animation: 'spin 0.8s linear infinite',
                                }} />
                                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cargando audio...</span>
                            </div>
                        )}
                    </div>

                    {/* Barra de progreso lineal */}
                    {ready && (
                        <div style={{ padding: '0 16px 2px' }}>
                            <div style={{ height: 3, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent-primary)', borderRadius: 2, transition: 'width 0.1s linear' }} />
                            </div>
                        </div>
                    )}

                    {/* Transport controls */}
                    {ready && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 16px 14px',
                        }}>
                            {/* −5s */}
                            <button onClick={() => wsRef.current?.setTime(Math.max(0, wsRef.current.getCurrentTime() - 5))}
                                style={btnGhostStyle}>−5s</button>

                            {/* Play/Pause */}
                            <button onClick={() => wsRef.current?.playPause()} title="Espacio" style={{
                                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                                border: '1.5px solid var(--border-default)', background: 'var(--bg-primary)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', color: playing ? '#dc2626' : 'var(--accent-primary)',
                                transition: 'all 0.15s',
                            }}>
                                {playing ? <IconPause /> : <IconPlay />}
                            </button>

                            {/* +5s */}
                            <button onClick={() => wsRef.current?.setTime(Math.min(duration, wsRef.current.getCurrentTime() + 5))}
                                style={btnGhostStyle}>+5s</button>

                            {/* Tiempo */}
                            <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-secondary)', minWidth: 100 }}>
                                {fmt(time)} <span style={{ color: 'var(--text-muted)' }}>/ {fmt(duration)}</span>
                            </span>

                            <div style={{ flex: 1 }} />

                            {/* Zoom controls */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
                                {/* Botón − */}
                                <button
                                    onClick={() => setZoom(z => Math.max(10, z - 20))}
                                    style={{ ...btnGhostStyle, width: 24, height: 24, justifyContent: 'center', fontSize: 16, fontWeight: 700 }}
                                    title="Reducir zoom"
                                >−</button>

                                <IconZoomOut />
                                <input
                                    type="range" min={10} max={500} step={10} value={zoom}
                                    onChange={e => setZoom(Number(e.target.value))}
                                    style={{ width: 100, accentColor: '#2563eb', cursor: 'pointer' }}
                                    title={`Zoom: ${zoom} px/s`}
                                />
                                <IconZoomIn />

                                {/* Botón + */}
                                <button
                                    onClick={() => setZoom(z => Math.min(500, z + 20))}
                                    style={{ ...btnGhostStyle, width: 24, height: 24, justifyContent: 'center', fontSize: 16, fontWeight: 700 }}
                                    title="Aumentar zoom"
                                >+</button>

                                <span style={{ fontSize: 11, minWidth: 36, textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                    {zoom}px
                                </span>
                            </div>

                            {/* Reset zoom */}
                            <button onClick={() => setZoom(30)} style={btnGhostStyle} title="Ver todo el audio">Fit</button>
                        </div>
                    )}
                </div>

                {/* Atajos */}
                {ready && (
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {[['Espacio', 'Play/Pausa'], ['← →', '±5 seg'], ['Delete', 'Borrar región']].map(([k, v]) => (
                            <span key={k} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                <kbd style={{
                                    background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
                                    borderRadius: 4, padding: '1px 5px', fontSize: 10, fontFamily: 'monospace',
                                    color: 'var(--text-secondary)', marginRight: 4,
                                }}>{k}</kbd>{v}
                            </span>
                        ))}
                    </div>
                )}

                {/* Lista de regiones (solo cuando modo regiones y hay regiones) */}
                {mode === 'regiones' && regions.length > 0 && (
                    <div style={{
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                        borderRadius: 12, padding: 14,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                                {regions.length} región{regions.length > 1 ? 'es' : ''} · Total {fmt(totalSel)} / {fmt(duration)}
                            </p>
                            <button onClick={clearRegions} style={{ ...btnGhostStyle, color: '#dc2626', fontSize: 11 }}>
                                Limpiar todo
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {regions.map((r, i) => (
                                <div key={r.id} onClick={() => {
                                    activeRegionRef.current = r.wsRegion
                                    setActiveId(r.id)
                                    wsRef.current?.setTime(r.start)
                                }} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                                    border: `1.5px solid ${activeId === r.id ? 'var(--accent-primary)' : 'rgba(37,99,235,0.2)'}`,
                                    background: activeId === r.id ? 'rgba(37,99,235,0.09)' : 'rgba(37,99,235,0.03)',
                                    transition: 'all 0.15s',
                                }}>
                                    <span style={{
                                        fontSize: 10, fontWeight: 700, color: 'white',
                                        background: 'var(--accent-primary)', borderRadius: 5,
                                        padding: '2px 6px', flexShrink: 0,
                                    }}>#{i + 1}</span>
                                    <span style={{ fontFamily: 'monospace', fontSize: 13, flex: 1, color: 'var(--text-primary)' }}>
                                        {fmt(r.start)}
                                        <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
                                        {fmt(r.end)}
                                    </span>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                        {fmt(r.end - r.start)}
                                    </span>
                                    <button onClick={e => { e.stopPropagation(); removeRegion(r.id) }}
                                        style={{ ...btnGhostStyle, color: '#9ca3af', padding: '2px 4px' }}>
                                        <IconTrash />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Input manual de región */}
                {mode === 'regiones' && ready && (
                    <div style={{
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                        borderRadius: 12, padding: 14,
                    }}>
                        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
                            <IconCut />  Añadir región exacta (mm:ss)
                        </p>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input type="text" placeholder="Inicio (ej. 1:30)" value={manualS}
                                onChange={e => setManualS(e.target.value)}
                                style={inputStyle} />
                            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>→</span>
                            <input type="text" placeholder="Fin (ej. 5:00)" value={manualE}
                                onChange={e => setManualE(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addManual()}
                                style={inputStyle} />
                            <button onClick={addManual} style={{
                                padding: '8px 16px', borderRadius: 8, flexShrink: 0,
                                background: 'var(--accent-primary)', color: 'white',
                                border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                            }}>+</button>
                        </div>
                        {manualErr && <p style={{ fontSize: 11, color: '#dc2626', marginTop: 6 }}>{manualErr}</p>}
                    </div>
                )}

            </div>

            {/* ══ COLUMNA DERECHA: modo + filtros + acción ══ */}
            <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Modo */}
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16 }}>
                    <p style={sectionLabel}>Qué procesar</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(['todo', 'regiones'] as const).map(m => (
                            <button key={m} onClick={() => setMode(m)} style={{
                                padding: '10px 14px', borderRadius: 9, textAlign: 'left',
                                border: `1.5px solid ${mode === m ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                                background: mode === m ? 'rgba(37,99,235,0.08)' : 'var(--bg-primary)',
                                color: mode === m ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                fontSize: 13, fontWeight: mode === m ? 600 : 400,
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}>
                                {m === 'todo' ? (
                                    <span>
                                        <span style={{ fontSize: 14, marginRight: 8 }}>⏵</span>
                                        Todo el audio
                                        {ready && <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>{fmt(duration)}</span>}
                                    </span>
                                ) : (
                                    <span>
                                        <span style={{ fontSize: 14, marginRight: 8 }}>✂</span>
                                        Solo regiones seleccionadas
                                        {mode === 'regiones' && regions.length > 0 && (
                                            <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>
                                                {regions.length} región{regions.length > 1 ? 'es' : ''} · {fmt(totalSel)}
                                            </span>
                                        )}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                    {mode === 'regiones' && regions.length === 0 && ready && (
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center', fontStyle: 'italic' }}>
                            Arrastra sobre el waveform para marcar zonas
                        </p>
                    )}
                </div>

                {/* Filtros */}
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16 }}>
                    <p style={sectionLabel}>Mejorar calidad</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {([
                            { k: 'noise_reduction' as const, label: 'Reducción de ruido', desc: 'Elimina ruido de fondo (afftdn)' },
                            { k: 'normalize' as const, label: 'Normalizar volumen', desc: 'EBU R128 · −16 LUFS estándar' },
                            { k: 'highpass' as const, label: 'Filtro de graves', desc: 'Elimina zumbidos <80 Hz' },
                        ]).map(({ k, label, desc }) => (
                            <label key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                                <div onClick={() => setFilters(p => ({ ...p, [k]: !p[k] }))} style={{
                                    width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
                                    border: `2px solid ${filters[k] ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                                    background: filters[k] ? 'var(--accent-primary)' : 'transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', transition: 'all 0.15s',
                                }}>
                                    {filters[k] && (
                                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5">
                                            <polyline points="1,6 4,9 11,2" />
                                        </svg>
                                    )}
                                </div>
                                <div>
                                    <p style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</p>
                                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{desc}</p>
                                </div>
                            </label>
                        ))}

                        {/* Volumen */}
                        <div style={{ paddingTop: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Amplificar volumen</span>
                                <span style={{
                                    fontSize: 12, fontFamily: 'monospace', padding: '1px 7px', borderRadius: 5,
                                    background: 'var(--bg-primary)',
                                    color: filters.volume !== 1.0 ? 'var(--accent-primary)' : 'var(--text-muted)',
                                }}>{filters.volume.toFixed(1)}×</span>
                            </div>
                            <input type="range" min={0.5} max={3} step={0.1} value={filters.volume}
                                onChange={e => setFilters(p => ({ ...p, volume: parseFloat(e.target.value) }))}
                                style={{ width: '100%', accentColor: '#2563eb' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                <span>0.5×</span><span>1×</span><span>2×</span><span>3×</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Error proceso */}
                {procError && (
                    <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 12, background: 'rgba(220,38,38,0.08)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
                        {procError}
                    </div>
                )}

                {/* Progreso */}
                {processing && (
                    <div>
                        <div style={{ height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--bg-primary)' }}>
                            <div style={{
                                height: '100%', borderRadius: 3, width: `${progress}%`,
                                background: 'linear-gradient(90deg, #2563eb, #f59e0b)',
                                transition: 'width 1.5s ease',
                            }} />
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                            {progress < 30 ? 'Preparando audio...' : progress < 70 ? 'Transcribiendo...' : progress < 90 ? 'Procesando hablantes...' : 'Finalizando...'} {progress}%
                        </p>
                    </div>
                )}

                {/* Botón principal */}
                <button onClick={handleProcess} disabled={!canProcess} style={{
                    padding: '14px 0', borderRadius: 12, width: '100%',
                    background: canProcess ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                    color: canProcess ? 'white' : 'var(--text-muted)',
                    border: `1.5px solid ${canProcess ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                    fontSize: 14, fontWeight: 700, cursor: canProcess ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s',
                }}>
                    {processing
                        ? `Procesando... ${progress}%`
                        : !ready
                        ? 'Cargando audio...'
                        : mode === 'regiones' && regions.length > 0
                        ? `Transcribir ${regions.length} región${regions.length > 1 ? 'es' : ''}`
                        : 'Transcribir audio completo'}
                </button>

                <button onClick={onCancelar} disabled={processing} className="btn-secondary"
                    style={{ width: '100%', opacity: processing ? 0.5 : 1 }}>
                    Cancelar y volver
                </button>

            </div>
        </div>
    )
}

/* ── Estilos compartidos ──────────────────────────────────────────────────── */

const btnGhostStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', fontSize: 11, padding: '3px 6px',
    borderRadius: 5, display: 'flex', alignItems: 'center', gap: 4,
    transition: 'color 0.15s',
}

const inputStyle: React.CSSProperties = {
    flex: 1, padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--border-default)',
    background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13,
    outline: 'none',
}

const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12,
}
