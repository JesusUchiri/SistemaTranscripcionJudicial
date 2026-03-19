'use client'

/**
 * ReproductorAudio — wavesurfer.js para reproducir el audio grabado.
 *
 * UI Minimalista: controles CSS sin emojis, tooltips en hover.
 *
 * Permite:
 * - Reproducción completa del audio de la audiencia
 * - Click en un segmento → salta al timestamp correspondiente
 * - Visualización de la onda con marcadores temporales
 * - Control de velocidad (0.5x → 2x) con preservación de pitch (sin chipmunk)
 */
import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'

export interface ReproductorAudioHandle {
    seekTo: (segundos: number) => void
    play: () => void
    pause: () => void
    getCurrentTime: () => number
}

interface ReproductorAudioProps {
    /** URL del archivo de audio (servido desde backend) */
    audioUrl: string | null
    /** Callback cuando cambia la posición del cursor de audio */
    onPosicionCambiada?: (segundos: number) => void
    /** Callback en cada frame de reproducción para sync con canvas */
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

    // Exponer métodos al componente padre
    useImperativeHandle(ref, () => ({
        seekTo: (segundos: number) => {
            if (wavesurferRef.current && duracion > 0) {
                wavesurferRef.current.seekTo(segundos / duracion)
            }
        },
        play: () => {
            wavesurferRef.current?.play()
        },
        pause: () => {
            wavesurferRef.current?.pause()
        },
        getCurrentTime: () => {
            return wavesurferRef.current?.getCurrentTime() || 0
        },
    }), [duracion])

    const blobUrlRef = useRef<string | null>(null)

    useEffect(() => {
        if (!contenedorRef.current || !audioUrl) return

        let ws: any = null

        const inicializar = async () => {
            setCargando(true)
            setCargado(false)
            setErrorCarga(null)

            const token =
                typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
            const headers: HeadersInit = {}
            if (token) headers['Authorization'] = `Bearer ${token}`

            let urlToLoad = audioUrl
            try {
                const res = await fetch(audioUrl, { headers })
                if (!res.ok) throw new Error('Audio no disponible')
                const blob = await res.blob()
                // Blob vacío o solo cabecera WAV (44 bytes) no se puede decodificar
                if (blob.size <= 44) {
                    setErrorCarga('La grabación está vacía o aún no hay audio.')
                    setCargando(false)
                    return
                }
                const blobUrl = URL.createObjectURL(blob)
                blobUrlRef.current = blobUrl
                urlToLoad = blobUrl
            } catch {
                setErrorCarga('No se pudo cargar el audio.')
                setCargando(false)
                return
            }

            const WaveSurfer = (await import('wavesurfer.js')).default

            // Usar HTMLAudioElement como backend para evitar decodeAudioData (EncodingError en WAV
            // con header incorrecto mientras el archivo aún se está escribiendo).
            const audioEl = document.createElement('audio')
            audioEl.preload = 'auto'

            ws = WaveSurfer.create({
                container: contenedorRef.current!,
                waveColor: 'rgba(37, 99, 235, 0.25)',
                progressColor: '#2563EB',
                cursorColor: '#2563EB',
                barWidth: 2,
                barGap: 1,
                barRadius: 2,
                height: 56,
                media: audioEl,
            })

            ws.on('ready', () => {
                setDuracion(ws.getDuration())
                setCargado(true)
                setCargando(false)
                setErrorCarga(null)
            })

            ws.on('error', () => {
                setErrorCarga('No se pudo decodificar el audio.')
                setCargado(false)
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

            ws.load(urlToLoad)
            wavesurferRef.current = ws
        }

        inicializar()

        return () => {
            ws?.destroy()
            wavesurferRef.current = null
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current)
                blobUrlRef.current = null
            }
        }
    }, [audioUrl])

    const toggleReproduccion = useCallback(() => {
        wavesurferRef.current?.playPause()
    }, [])

    const saltarA = useCallback((segundos: number) => {
        wavesurferRef.current?.seekTo(segundos / duracion)
    }, [duracion])

    const cambiarVelocidad = useCallback((nueva: number) => {
        setVelocidad(nueva)
        // preservePitch=true → mantiene el tono original sin efecto chipmunk
        wavesurferRef.current?.setPlaybackRate(nueva, true)
    }, [])

    const formatearTiempo = (seg: number) => {
        const h = Math.floor(seg / 3600)
        const min = Math.floor((seg % 3600) / 60).toString().padStart(2, '0')
        const s = Math.floor(seg % 60).toString().padStart(2, '0')
        return h > 0 ? `${h}:${min}:${s}` : `${min}:${s}`
    }

    if (!audioUrl) {
        return (
            <div
                className="px-4 py-4 text-sm text-center"
                style={{ color: 'var(--text-muted)' }}
            >
                El audio estará disponible al finalizar la grabación.
            </div>
        )
    }

    if (errorCarga) {
        return (
            <div className="px-3 sm:px-4 py-3 sm:py-4">
                <h3
                    className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-2 sm:mb-3"
                    style={{ color: 'var(--text-muted)' }}
                >
                    Audio
                </h3>
                <div
                    className="rounded-lg px-4 py-3 text-sm"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                >
                    {errorCarga}
                </div>
            </div>
        )
    }

    return (
        <div className="px-3 sm:px-4 py-3 sm:py-4">
            <h3
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-2 sm:mb-3"
                style={{ color: 'var(--text-muted)' }}
            >
                Audio
            </h3>

            {/* Onda de audio — siempre montada para que WaveSurfer tenga el contenedor */}
            <div
                ref={contenedorRef}
                className="rounded-lg overflow-hidden mb-3 sm:mb-4"
                style={{
                    background: 'var(--bg-secondary)',
                    display: cargando ? 'none' : 'block',
                }}
            />

            {/* Estado de carga */}
            {cargando && (
                <div
                    className="rounded-lg mb-3 sm:mb-4 flex items-center justify-center gap-2 py-4"
                    style={{ background: 'var(--bg-secondary)', minHeight: '56px' }}
                >
                    <span
                        className="w-3 h-3 rounded-full animate-spin border-2"
                        style={{
                            borderColor: 'var(--accent-primary)',
                            borderTopColor: 'transparent',
                        }}
                    />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Cargando audio...
                    </span>
                </div>
            )}

            {/* Controles */}
            <div className="flex items-center gap-3 sm:gap-4">

                {/* Botón Play/Pause */}
                <button
                    onClick={toggleReproduccion}
                    disabled={!cargado}
                    className={`audio-control shrink-0 ${reproduciendo ? 'audio-control--pause' : 'audio-control--play'}`}
                    data-tooltip={reproduciendo ? 'Pausar' : 'Reproducir'}
                    style={{
                        color: !cargado
                            ? 'var(--text-muted)'
                            : reproduciendo ? 'var(--danger)' : 'var(--accent-primary)',
                        borderColor: !cargado
                            ? 'var(--border-subtle)'
                            : reproduciendo ? 'rgba(220, 38, 38, 0.3)' : 'var(--border-default)',
                        width: '32px',
                        height: '32px',
                        opacity: !cargado ? 0.4 : 1,
                        cursor: !cargado ? 'not-allowed' : 'pointer',
                    }}
                />

                {/* Tiempo */}
                <span
                    className="text-xs sm:text-sm font-mono tabular-nums shrink-0"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    {cargando
                        ? '--:--'
                        : `${formatearTiempo(posicion)} / ${formatearTiempo(duracion)}`
                    }
                </span>

                {/* Control de velocidad */}
                <div className="speed-slider ml-auto gap-1 sm:gap-2 px-2 sm:px-3 py-1">
                    <span className="text-[10px] sm:text-xs font-bold">{velocidad.toFixed(2)}x</span>
                    <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.25"
                        value={velocidad}
                        onChange={(e) => cambiarVelocidad(parseFloat(e.target.value))}
                        className="w-10 sm:w-16"
                        title="Velocidad de reproducción (sin cambio de tono)"
                        disabled={!cargado}
                    />
                </div>

            </div>
        </div>
    )
})

ReproductorAudio.displayName = 'ReproductorAudio'

export default ReproductorAudio
