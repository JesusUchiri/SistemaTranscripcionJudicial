'use client'

/**
 * Transcribir — Página de carga y edición de audio.
 */
import { useCallback, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'
import AudioEditorPre, { ProcesarResult } from '@/components/audio/AudioEditorPre'
import { motion, AnimatePresence } from 'framer-motion'
import { 
    Upload, 
    FileAudio, 
    ChevronRight, 
    X, 
    CheckCircle2, 
    AlertCircle, 
    Loader2,
    Database,
    Clock,
    Activity
} from 'lucide-react'

type UploadPhase = 'idle' | 'selected' | 'uploading' | 'editando' | 'done' | 'error'

interface EditandoData { 
    audienciaId: string
    duracion: number 
}

interface UploadResult {
    audiencia_id: string
    mensaje: string
    total_segmentos?: number
    hablantes_detectados?: number
    duracion_segundos?: number
    costo_total_usd?: number
}

const ACCEPTED = '.wav,.mp3,.mp4,.m4a,.ogg,.webm,.flac,.aac'
const VALID_EXTS = ['wav', 'mp3', 'mp4', 'm4a', 'ogg', 'webm', 'flac', 'aac']

function fmtBytes(b: number) {
    if (b < 1024) return `${b} B`
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 ** 2).toFixed(1)} MB`
}

export default function TranscribirPage() {
    const router = useRouter()
    const { logout, user } = useAuthStore()

    useEffect(() => {
        if (user?.rol === 'admin') router.replace('/admin')
    }, [user, router])

    const fileRef = useRef<HTMLInputElement>(null)
    const [phase, setPhase] = useState<UploadPhase>('idle')
    const [file, setFile] = useState<File | null>(null)
    const [drag, setDrag] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [progress, setProgress] = useState(0)
    const [editando, setEditando] = useState<EditandoData | null>(null)
    const [result, setResult] = useState<UploadResult | null>(null)

    const [expediente, setExpediente] = useState('')
    const [juzgado, setJuzgado] = useState('')
    const [tipo, setTipo] = useState('Audiencia General')
    const [instancia, setInstancia] = useState('Primera Instancia')

    const selectFile = useCallback((f: File) => {
        setError(null)
        if (f.size > 2 * 1024 ** 3) { setError('El archivo es demasiado grande. Máximo: 2GB'); return }
        const ext = f.name.split('.').pop()?.toLowerCase()
        if (!ext || !VALID_EXTS.includes(ext)) {
            setError('Formato no soportado.')
            return
        }
        setFile(f)
        setPhase('selected')
    }, [])

    const handleSubir = async () => {
        if (!file || !expediente.trim() || !juzgado.trim()) {
            setError('Completa los campos requeridos.')
            return
        }
        setPhase('uploading')
        setError(null)
        setProgress(0)
        try {
            const fd = new FormData()
            fd.append('audio', file)
            fd.append('expediente', expediente.trim())
            fd.append('juzgado', juzgado.trim())
            fd.append('tipo_audiencia', tipo)
            fd.append('instancia', instancia)

            const { data } = await api.post('/api/transcripcion-audio/subir', fd, {
                headers: { 'Content-Type': undefined },
                timeout: 600_000,
                onUploadProgress: ev => {
                    const total = ev.total ?? 0
                    if (total > 0) setProgress(Math.round((ev.loaded / total) * 100))
                },
            })
            setProgress(100)
            setEditando({ audienciaId: data.audiencia_id, duracion: data.duracion_segundos ?? 0 })
            setPhase('editando')
        } catch (err: any) {
            setPhase('error')
            setError(err.response?.data?.detail || 'Error al subir el audio.')
        }
    }

    const handleProcesado = useCallback(async (res: ProcesarResult) => {
        if (!editando) return
        setPhase('uploading')
        setProgress(100) // Indica que estamos procesando en backend
        try {
            await api.post('/api/transcripcion-audio/procesar', {
                audiencia_id: editando.audienciaId,
                regions: res.regions,
                filters: res.filters
            })
            router.push(`/audiencia/${editando.audienciaId}`)
        } catch (err) {
            setPhase('error')
            setError('Error al iniciar procesamiento.')
        }
    }, [editando, router])

    const reset = () => {
        setFile(null); setPhase('idle'); setError(null); setResult(null)
        setEditando(null); setProgress(0); setExpediente(''); setJuzgado('')
        if (fileRef.current) fileRef.current.value = ''
    }

    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#FDFCFB] flex flex-col">
                {/* ── Header Premium ────────────────────────── */}
                <header className="px-8 py-4 bg-white border-b border-[#1B3A5C]/5 flex items-center justify-between sticky top-0 z-50">
                    <div className="flex items-center gap-4">
                        <div className="logo-monogram cursor-pointer" onClick={() => router.push('/dashboard')}>J</div>
                        <div>
                            <h1 className="text-sm font-bold text-[#1B3A5C]">Carga de Archivo</h1>
                            <p className="text-[10px] uppercase tracking-widest text-[#A68246] font-bold">Ingreso de Audio Oficial</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => router.push('/dashboard')} className="btn-secondary !text-xs !py-2">Dashboard</button>
                        <button onClick={async () => { await logout(); router.push('/login') }} className="text-[10px] font-bold text-[#1B3A5C]/40 uppercase tracking-widest hover:text-red-500 transition-all">Salir</button>
                    </div>
                </header>

                <main className="flex-1 max-w-4xl mx-auto w-full px-8 py-12">
                    <AnimatePresence mode="wait">
                        {phase === 'idle' && (
                            <motion.div 
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className="upload-dropzone min-h-[300px] rounded-[40px] border-2 border-dashed border-[#1B3A5C]/10 bg-white flex flex-col items-center justify-center p-12 cursor-pointer hover:border-[#A68246]/30 hover:bg-[#FDFCFB] transition-all group"
                                onClick={() => fileRef.current?.click()}
                                onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) selectFile(f) }}
                                onDragOver={e => { e.preventDefault(); setDrag(true) }}
                                onDragLeave={() => setDrag(false)}
                            >
                                <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) selectFile(f) }} />
                                <div className="w-20 h-20 bg-[#1B3A5C]/5 text-[#1B3A5C]/20 rounded-[32px] flex items-center justify-center mb-6 group-hover:scale-110 group-hover:text-[#A68246] group-hover:bg-[#A68246]/5 transition-all">
                                    <Upload className="w-10 h-10" />
                                </div>
                                <h3 className="text-xl font-bold text-[#1B3A5C] mb-2">Comience la Carga</h3>
                                <p className="text-sm text-[#1B3A5C]/40 text-center max-w-xs">Arrastre el archivo de audio o haga clic para seleccionar desde su equipo.</p>
                                <div className="mt-8 flex gap-4">
                                    <span className="px-3 py-1 bg-[#1B3A5C]/5 rounded-lg text-[9px] font-bold text-[#1B3A5C]/40 uppercase tracking-widest">WAV · MP3 · MP4</span>
                                    <span className="px-3 py-1 bg-[#1B3A5C]/5 rounded-lg text-[9px] font-bold text-[#1B3A5C]/40 uppercase tracking-widest">Máximo 2GB</span>
                                </div>
                            </motion.div>
                        )}

                        {phase === 'selected' && file && (
                            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-10">
                                <div className="p-6 bg-white rounded-[32px] border border-[#1B3A5C]/5 shadow-xl shadow-[#1B3A5C]/5 flex items-center gap-6">
                                    <div className="w-16 h-16 bg-[#A68246]/10 text-[#A68246] rounded-2xl flex items-center justify-center">
                                        <FileAudio className="w-8 h-8" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-bold text-[#1B3A5C] truncate">{file.name}</h4>
                                        <p className="text-xs text-[#1B3A5C]/40 font-bold uppercase tracking-widest">{fmtBytes(file.size)}</p>
                                    </div>
                                    <button onClick={reset} className="p-2 text-[#1B3A5C]/20 hover:text-red-500 transition-colors"><X className="w-6 h-6" /></button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">N° Expediente *</label>
                                        <input type="text" value={expediente} onChange={e => setExpediente(e.target.value)} placeholder="00XXX-202X..." className="w-full px-5 py-4 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/40 ml-1">Juzgado *</label>
                                        <input type="text" value={juzgado} onChange={e => setJuzgado(e.target.value)} placeholder="Nombre de la sede..." className="w-full px-5 py-4 bg-white border border-[#1B3A5C]/10 rounded-2xl text-sm focus:ring-2 focus:ring-[#A68246]/20 transition-all outline-none" />
                                    </div>
                                </div>

                                <button onClick={handleSubir} className="w-full py-5 bg-[#1B3A5C] text-white rounded-[24px] font-bold text-sm uppercase tracking-[0.2em] shadow-2xl shadow-[#1B3A5C]/20 hover:brightness-110 transition-all flex items-center justify-center gap-3">
                                    Subir y Editar Audio <ChevronRight className="w-5 h-5" />
                                </button>
                            </motion.div>
                        )}

                        {phase === 'uploading' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20">
                                <div className="relative mb-10">
                                    <div className="w-24 h-24 border-4 border-[#A68246]/10 rounded-full" />
                                    <div className="absolute inset-0 w-24 h-24 border-4 border-[#A68246] border-t-transparent rounded-full animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold text-[#1B3A5C]">{progress}%</div>
                                </div>
                                <h3 className="text-xl font-bold text-[#1B3A5C] mb-2">Transfiriendo Expediente</h3>
                                <p className="text-xs text-[#1B3A5C]/40 font-bold uppercase tracking-widest">Sincronización con Servidores Judiciales</p>
                            </motion.div>
                        )}

                        {phase === 'editando' && file && (
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="fixed inset-0 z-[100]">
                                <AudioEditorPre file={file} onProcess={handleProcesado} onCancel={() => setPhase('selected')} />
                            </motion.div>
                        )}

                        {phase === 'error' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
                                <div className="w-20 h-20 bg-red-50 text-red-500 rounded-[32px] flex items-center justify-center mx-auto mb-8">
                                    <AlertCircle className="w-10 h-10" />
                                </div>
                                <h3 className="text-xl font-bold text-[#1B3A5C] mb-2">Error de Procesamiento</h3>
                                <p className="text-sm text-red-600/60 mb-10 max-w-sm mx-auto">{error}</p>
                                <button onClick={reset} className="btn-secondary !py-3 !px-8">Reintentar Carga</button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </main>
            </div>
        </AuthGuard>
    )
}
