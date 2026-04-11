'use client'

/**
 * AudioEditorPre — Editor de audio previo a la transcripción (Modo Batch).
 * Permite recortar, silenciar partes y aplicar filtros básicos antes de enviar a Deepgram.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { 
    Scissors, 
    Volume2, 
    VolumeX, 
    Play, 
    Pause, 
    RotateCcw, 
    Save, 
    Wand2, 
    Mic2,
    Check,
    X,
    Loader2
} from 'lucide-react'

export interface ProcesarResult {
    regions: Array<{ start: number; end: number }>
    filters: {
        normalize: boolean
        removeSilence: boolean
        volume: number
    }
}

interface AudioEditorPreProps {
    file: File
    onProcess: (result: ProcesarResult) => void
    onCancel: () => void
}

export default function AudioEditorPre({ file, onProcess, onCancel }: AudioEditorPreProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const wavesurferRef = useRef<any>(null)
    const regionsRef = useRef<any>(null)
    
    const [playing, setPlaying] = useState(false)
    const [duration, setDuration] = useState(0)
    const [cargado, setCargado] = useState(false)
    const [activeId, setActiveId] = useState<string | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const [mode, setMode] = useState<'trim' | 'mute'>('trim')
    const [filters, setFilters] = useState({
        normalize: true,
        removeSilence: false,
        volume: 1.0
    })

    useEffect(() => {
        if (!containerRef.current) return

        let ws: any = null
        const init = async () => {
            const WaveSurfer = (await import('wavesurfer.js')).default
            const Regions = (await import('wavesurfer.js/dist/plugins/regions.js')).default

            ws = WaveSurfer.create({
                container: containerRef.current!,
                waveColor: 'rgba(27, 58, 92, 0.1)',
                progressColor: '#A68246',
                cursorColor: '#1B3A5C',
                barWidth: 2,
                barGap: 3,
                barRadius: 4,
                height: 120,
                normalize: true,
            })

            const regions = ws.registerPlugin(Regions.create())
            regionsRef.current = regions

            ws.on('ready', () => {
                setDuration(ws.getDuration())
                setCargado(true)
                // Crear región inicial que cubra todo
                regions.addRegion({
                    start: 0,
                    end: ws.getDuration(),
                    color: 'rgba(166, 130, 70, 0.1)',
                    drag: true,
                    resize: true
                })
            })

            regions.on('region-clicked', (region: any) => {
                setActiveId(region.id)
                region.play()
            })

            ws.on('play', () => setPlaying(true))
            ws.on('pause', () => setPlaying(false))

            const url = URL.createObjectURL(file)
            ws.load(url)
            wavesurferRef.current = ws
        }

        init()
        return () => ws?.destroy()
    }, [file])

    const handleProcess = async () => {
        setIsProcessing(true)
        
        // Obtener regiones actuales del plugin
        const regions = regionsRef.current?.getRegions() || []
        const regionsData = regions.map((r: any) => ({ start: r.start, end: r.end }))

        setTimeout(() => {
            onProcess({
                regions: regionsData,
                filters: {
                    normalize: filters.normalize,
                    removeSilence: filters.removeSilence,
                    volume: filters.volume
                }
            })
            setIsProcessing(false)
        }, 1000)
    }

    return (
        <div className="fixed inset-0 z-[60] bg-[#1B3A5C]/40 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col animate-fade-in border border-[#A68246]/20">
                
                {/* Header */}
                <div className="px-8 py-6 bg-[#FDFCFB] border-b border-[#1B3A5C]/5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-[#1B3A5C] text-white rounded-2xl flex items-center justify-center shadow-lg shadow-[#1B3A5C]/20">
                            <Scissors className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-[#1B3A5C]">Editor de Audio</h2>
                            <p className="text-xs text-[#1B3A5C]/40 font-bold uppercase tracking-widest">Optimización Pre-Transcripción</p>
                        </div>
                    </div>
                    <button onClick={onCancel} className="p-2 text-[#1B3A5C]/20 hover:text-red-500 transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                    {/* Visualizer */}
                    <div className="relative bg-[#F7F5F2] rounded-[24px] p-6 mb-8 border border-[#1B3A5C]/5">
                        <div ref={containerRef} />
                        {!cargado && (
                            <div className="absolute inset-0 flex items-center justify-center bg-[#F7F5F2]/80 backdrop-blur-sm rounded-[24px]">
                                <Loader2 className="w-8 h-8 animate-spin text-[#A68246]" />
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {/* Controles de Reproducción */}
                        <div className="space-y-4">
                            <span className="text-[10px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Transporte</span>
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => wavesurferRef.current?.playPause()}
                                    className="w-14 h-14 flex items-center justify-center rounded-2xl bg-[#1B3A5C] text-white shadow-xl shadow-[#1B3A5C]/20 hover:scale-105 transition-all"
                                >
                                    {playing ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                                </button>
                                <button
                                    onClick={() => wavesurferRef.current?.stop()}
                                    className="w-12 h-12 flex items-center justify-center rounded-xl bg-[#1B3A5C]/5 text-[#1B3A5C] hover:bg-[#1B3A5C]/10 transition-all"
                                >
                                    <RotateCcw className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Herramientas */}
                        <div className="space-y-4">
                            <span className="text-[10px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Herramientas</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setMode('trim')}
                                    className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${
                                        mode === 'trim' ? 'bg-[#1B3A5C] text-white border-[#1B3A5C]' : 'bg-white text-[#1B3A5C]/40 border-[#1B3A5C]/10 hover:border-[#1B3A5C]/30'
                                    }`}
                                >
                                    Recortar
                                </button>
                                <button
                                    onClick={() => setMode('mute')}
                                    className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${
                                        mode === 'mute' ? 'bg-[#1B3A5C] text-white border-[#1B3A5C]' : 'bg-white text-[#1B3A5C]/40 border-[#1B3A5C]/10 hover:border-[#1B3A5C]/30'
                                    }`}
                                >
                                    Silenciar
                                </button>
                            </div>
                        </div>

                        {/* Filtros Inteligentes */}
                        <div className="space-y-4">
                            <span className="text-[10px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Mejoras IA</span>
                            <div className="space-y-2">
                                <button
                                    onClick={() => setFilters(f => ({ ...f, normalize: !f.normalize }))}
                                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                                        filters.normalize ? 'bg-[#A68246]/5 border-[#A68246]/30 text-[#A68246]' : 'bg-white border-[#1B3A5C]/5 text-[#1B3A5C]/40'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <Wand2 className="w-3.5 h-3.5" />
                                        <span className="text-[10px] font-bold uppercase">Normalizar</span>
                                    </div>
                                    {filters.normalize && <Check className="w-3 h-3" />}
                                </button>
                                <button
                                    onClick={() => setFilters(f => ({ ...f, removeSilence: !f.removeSilence }))}
                                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                                        filters.removeSilence ? 'bg-[#A68246]/5 border-[#A68246]/30 text-[#A68246]' : 'bg-white border-[#1B3A5C]/5 text-[#1B3A5C]/40'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <VolumeX className="w-3.5 h-3.5" />
                                        <span className="text-[10px] font-bold uppercase">Quitar Silencios</span>
                                    </div>
                                    {filters.removeSilence && <Check className="w-3 h-3" />}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-6 bg-[#FDFCFB] border-t border-[#1B3A5C]/5 flex items-center justify-between">
                    <button 
                        onClick={onCancel}
                        className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 hover:text-red-500 transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleProcess}
                        disabled={isProcessing || !cargado}
                        className="px-8 py-4 bg-[#1B3A5C] text-white rounded-2xl font-bold text-xs uppercase tracking-[0.2em] hover:brightness-110 shadow-xl shadow-[#1B3A5C]/20 disabled:opacity-30 transition-all flex items-center gap-3"
                    >
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Procesar y Transcribir
                    </button>
                </div>
            </div>
        </div>
    )
}
