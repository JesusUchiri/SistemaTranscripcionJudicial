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

    const blobUrlRef = useRef<string | null>(null)

    useEffect(() => {
        if (!contenedorRef.current || !audioUrl) return

        let ws: any = null

        const inicializar = async () => {
            setCargando(true)
            setCargado(false)
            setErrorCarga(null)

            const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
            const headers: HeadersInit = {}
            if (token) headers['Authorization'] = `Bearer ${token}`

            try {
                const res = await fetch(audioUrl, { headers })
                if (!res.ok) throw new Error('Audio no disponible')
                const blob = await res.blob()
                if (blob.size <= 44) {
                    setErrorCarga('Grabación vacía.')
                    setCargando(false)
                    return
                }
                const blobUrl = URL.createObjectURL(blob)
                blobUrlRef.current = blobUrl

                const WaveSurfer = (await import('wavesurfer.js')).default
                ws = WaveSurfer.create({
                    container: contenedorRef.current!,
                    waveColor: 'rgba(27, 58, 92, 0.1)',
                    progressColor: '#A68246',
                    cursorColor: '#1B3A5C',
                    barWidth: 2,
                    barGap: 3,
                    barRadius: 4,
                    height: 48,
                    normalize: true,
                })

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

                ws.load(blobUrl)
                wavesurferRef.current = ws
            } catch (err) {
                setErrorCarga('Error al cargar audio.')
                setCargando(false)
            }
        }

        inicializar()
        return () => {
            ws?.destroy()
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
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
