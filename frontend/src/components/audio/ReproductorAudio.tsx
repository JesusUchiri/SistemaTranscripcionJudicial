'use client'

/**
 * ReproductorAudio — Refinado con estética "Tinta y Oro".
 */
import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Play, Pause, FastForward, Loader2 } from 'lucide-react'

export interface ReproductorAudioHandle {
    seekTo: (segundos: number) => void
    play: () => void
    pause: () => void
    getCurrentTime: () => number
}

interface ReproductorAudioProps {
    audioUrl: string | null
    onPosicionCambiada?: (segundos: number) => void
    onTimeUpdate?: (segundos: number) => void
}

const ReproductorAudio = forwardRef<ReproductorAudioHandle, ReproductorAudioProps>(({
    audioUrl,
    onPosicionCambiada,
    onTimeUpdate,
}, ref) => {
    const contenedorRef = useRef<HTMLDivElement>(null)
    const wavesurferRef = useRef<any>(null)
    const [reproduciendo, setReproduciendo] = useState(false)
    const [posicion, setPosicion] = useState(0)
    const [duracion, setDuracion] = useState(0)
    const [velocidad, setVelocidad] = useState(1)
    const [cargando, setCargando] = useState(false)
    const [cargado, setCargado] = useState(false)
    const [errorCarga, setErrorCarga] = useState<string | null>(null)
    // Progress de la descarga del audio:
    // total_bytes (vía HEAD), bytes descargados, ms transcurridos.
    const [progressBytes, setProgressBytes] = useState(0)
    const [totalBytes, setTotalBytes] = useState(0)
    const [modoStream, setModoStream] = useState(false)  // true = streaming sin onda (archivos enormes)

    useImperativeHandle(ref, () => ({
        seekTo: (segundos: number) => {
            if (wavesurferRef.current && duracion > 0) {
                wavesurferRef.current.seekTo(segundos / duracion)
            }
        },
        play: () => wavesurferRef.current?.play(),
        pause: () => wavesurferRef.current?.pause(),
        getCurrentTime: () => wavesurferRef.current?.getCurrentTime() || 0,
    }), [duracion])

    const audioElementRef = useRef<HTMLAudioElement | null>(null)

    // Umbral para decidir si cargamos el audio completo (mejor onda)
    // o usamos streaming (archivos enormes que pondrían en riesgo la memoria del navegador).
    const STREAMING_THRESHOLD_BYTES = 150 * 1024 * 1024  // 150 MB

    useEffect(() => {
        if (!contenedorRef.current || !audioUrl) return

        let ws: any = null
        let cancelado = false
        let xhr: XMLHttpRequest | null = null
        const blobUrls: string[] = []

        const inicializar = async () => {
            setCargando(true)
            setCargado(false)
            setErrorCarga(null)
            setProgressBytes(0)
            setTotalBytes(0)
            setModoStream(false)

            const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
            const urlConToken = token
                ? `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`
                : audioUrl

            try {
                // 1) HEAD para conocer tamaño y decidir estrategia
                const headRes = await fetch(urlConToken, { method: 'HEAD' })
                if (cancelado) return
                if (!headRes.ok) {
                    setErrorCarga('Audio no disponible en el servidor.')
                    setCargando(false)
                    return
                }
                const tamano = parseInt(headRes.headers.get('content-length') || '0', 10)
                setTotalBytes(tamano)

                const WaveSurfer = (await import('wavesurfer.js')).default
                if (cancelado) return

                const wsBaseConfig = {
                    container: contenedorRef.current!,
                    waveColor: 'rgba(27, 58, 92, 0.15)',
                    progressColor: '#A68246',
                    cursorColor: '#1B3A5C',
                    barWidth: 2,
                    barGap: 3,
                    barRadius: 4,
                    height: 48,
                    normalize: true,
                }

                if (tamano > 0 && tamano < STREAMING_THRESHOLD_BYTES) {
                    // MODO COMPLETO: descarga XHR con onProgress → wavesurfer pinta la onda real.
                    const blob = await new Promise<Blob>((resolve, reject) => {
                        xhr = new XMLHttpRequest()
                        xhr.open('GET', urlConToken, true)
                        xhr.responseType = 'blob'
                        xhr.onprogress = (e) => {
                            if (cancelado) return
                            setProgressBytes(e.loaded)
                            if (e.lengthComputable && e.total > 0 && tamano === 0) setTotalBytes(e.total)
                        }
                        xhr.onload = () => {
                            if (xhr!.status >= 200 && xhr!.status < 300) resolve(xhr!.response as Blob)
                            else reject(new Error(`HTTP ${xhr!.status}`))
                        }
                        xhr.onerror = () => reject(new Error('Error de red'))
                        xhr.onabort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
                        xhr.send()
                    })
                    if (cancelado) return
                    const blobUrl = URL.createObjectURL(blob)
                    blobUrls.push(blobUrl)

                    ws = WaveSurfer.create(wsBaseConfig)
                    ws.on('ready', () => {
                        setDuracion(ws.getDuration())
                        setCargado(true)
                        setCargando(false)
                    })
                    ws.on('audioprocess', () => {
                        const tiempo = ws.getCurrentTime()
                        setPosicion(tiempo)
                        onPosicionCambiada?.(tiempo)
                        onTimeUpdate?.(tiempo)
                    })
                    ws.on('play', () => setReproduciendo(true))
                    ws.on('pause', () => setReproduciendo(false))
                    ws.on('finish', () => setReproduciendo(false))
                    ws.on('error', (e: any) => {
                        if (cancelado) return
                        const msg = e?.message || String(e)
                        if (msg.includes('aborted')) return
                        setErrorCarga('No se pudo decodificar el audio (formato exótico). Recarga la página.')
                        setCargando(false)
                    })
                    ws.load(blobUrl)
                    wavesurferRef.current = ws
                } else {
                    // MODO STREAMING: archivo enorme, no cargar a memoria.
                    // <audio> HTML5 + Range requests del backend.
                    setModoStream(true)
                    const audioEl = new Audio()
                    audioEl.crossOrigin = 'anonymous'
                    audioEl.preload = 'metadata'
                    audioEl.src = urlConToken
                    audioElementRef.current = audioEl

                    // Progress sintético basado en `audioEl.buffered` (rangos descargados)
                    audioEl.addEventListener('progress', () => {
                        if (cancelado) return
                        if (audioEl.buffered.length > 0) {
                            const cargadoSec = audioEl.buffered.end(audioEl.buffered.length - 1)
                            const totalSec = audioEl.duration || 1
                            setProgressBytes(Math.round((cargadoSec / totalSec) * tamano))
                        }
                    })
                    audioEl.addEventListener('error', () => {
                        if (cancelado) return
                        setErrorCarga('No se pudo cargar el audio del servidor.')
                        setCargando(false)
                    })

                    ws = WaveSurfer.create({ ...wsBaseConfig, media: audioEl })
                    ws.on('ready', () => {
                        setDuracion(ws.getDuration())
                        setCargado(true)
                        setCargando(false)
                    })
                    ws.on('audioprocess', () => {
                        const tiempo = ws.getCurrentTime()
                        setPosicion(tiempo)
                        onPosicionCambiada?.(tiempo)
                        onTimeUpdate?.(tiempo)
                    })
                    ws.on('play', () => setReproduciendo(true))
                    ws.on('pause', () => setReproduciendo(false))
                    ws.on('finish', () => setReproduciendo(false))
                    ws.on('error', (e: any) => {
                        if (cancelado) return
                        const msg = e?.message || String(e)
                        if (msg.includes('aborted')) return
                        setErrorCarga('Error de reproducción.')
                        setCargando(false)
                    })
                    wavesurferRef.current = ws
                }
            } catch (err: any) {
                if (err?.name === 'AbortError' || cancelado) return
                setErrorCarga('Error al cargar audio: ' + (err?.message || 'desconocido'))
                setCargando(false)
            }
        }

        inicializar()
        return () => {
            cancelado = true
            try { xhr?.abort() } catch { /* ignorar */ }
            try { ws?.destroy() } catch { /* destroy puede lanzar si carga estaba en vuelo */ }
            if (audioElementRef.current) {
                try {
                    audioElementRef.current.pause()
                    audioElementRef.current.src = ''
                    audioElementRef.current.load()
                } catch { /* ignorar */ }
                audioElementRef.current = null
            }
            blobUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch { /**/ } })
        }
    }, [audioUrl])

    const cambiarVelocidad = (v: number) => {
        setVelocidad(v)
        wavesurferRef.current?.setPlaybackRate(v, true)
    }

    const formatearTiempo = (seg: number) => {
        const m = Math.floor(seg / 60).toString().padStart(2, '0')
        const s = Math.floor(seg % 60).toString().padStart(2, '0')
        return `${m}:${s}`
    }

    if (!audioUrl) return null

    return (
        <div className="p-4 bg-white rounded-2xl border border-[#1B3A5C]/5">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1B3A5C]/40">Registro Fonográfico</h3>
                {cargando && <Loader2 className="w-3 h-3 animate-spin text-[#A68246]" />}
            </div>

            {errorCarga ? (
                <div className="py-4 text-center text-[10px] font-bold text-red-400 uppercase tracking-widest bg-red-50 rounded-xl">
                    {errorCarga}
                </div>
            ) : (
                <>
                    {cargando && totalBytes > 0 && (() => {
                        const mb = (b: number) => (b / 1024 / 1024).toFixed(1)
                        const pct = totalBytes > 0 ? Math.min(100, Math.round((progressBytes / totalBytes) * 100)) : 0
                        return (
                            <div className="mb-4 py-4 px-3 bg-[#FDFCFB] rounded-xl border border-[#1B3A5C]/5">
                                <div className="flex items-baseline justify-between mb-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/60">
                                        {modoStream ? 'Streaming (archivo grande)' : 'Cargando audio'}
                                    </p>
                                    <p className="text-[10px] font-mono font-bold text-[#1B3A5C]">
                                        {pct}% · {mb(progressBytes)} / {mb(totalBytes)} MB
                                    </p>
                                </div>
                                <div className="w-full h-1.5 bg-[#1B3A5C]/5 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-[#A68246] transition-[width] duration-200 ease-out"
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                                {modoStream && (
                                    <p className="text-[9px] text-[#1B3A5C]/40 mt-2 leading-snug">
                                        Audio &gt; {Math.round(STREAMING_THRESHOLD_BYTES / 1024 / 1024)} MB · sin forma de onda completa, reproducción por rangos.
                                    </p>
                                )}
                            </div>
                        )
                    })()}
                    <div ref={contenedorRef} className="mb-4" style={{ display: cargando ? 'none' : 'block' }} />
                    
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => wavesurferRef.current?.playPause()}
                            disabled={!cargado}
                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1B3A5C] text-white shadow-lg shadow-[#1B3A5C]/20 hover:scale-105 transition-all disabled:opacity-30"
                        >
                            {reproduciendo ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                        </button>

                        <div className="flex flex-col">
                            <span className="text-xs font-mono font-bold text-[#1B3A5C]">
                                {formatearTiempo(posicion)}
                            </span>
                            <span className="text-[9px] font-bold text-[#1B3A5C]/30 uppercase tracking-tighter">
                                de {formatearTiempo(duracion)}
                            </span>
                        </div>

                        <div className="ml-auto flex items-center gap-2 bg-[#1B3A5C]/5 p-1 rounded-lg">
                            {[1, 1.5, 2].map(v => (
                                <button
                                    key={v}
                                    onClick={() => cambiarVelocidad(v)}
                                    className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${
                                        velocidad === v ? 'bg-white text-[#1B3A5C] shadow-sm' : 'text-[#1B3A5C]/40 hover:text-[#1B3A5C]'
                                    }`}
                                >
                                    {v}x
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    )
})

ReproductorAudio.displayName = 'ReproductorAudio'
export default ReproductorAudio
