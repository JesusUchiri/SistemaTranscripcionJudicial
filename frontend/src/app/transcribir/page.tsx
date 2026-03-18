'use client'

/**
 * Página de transcripción de audio — Subir archivos pregrabados.
 */
import { useCallback, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'

/* ── Types ──────────────────────────────────────────── */

interface TranscriptionResult {
    audiencia_id: string
    expediente: string
    estado: string
    total_segmentos: number
    duracion_segundos: number
    hablantes_detectados: number
    mensaje: string
}

type UploadPhase = 'idle' | 'selected' | 'uploading' | 'transcribing' | 'done' | 'error'

const ACCEPTED_EXTENSIONS = '.wav,.mp3,.mp4,.m4a,.ogg,.webm,.flac,.aac'
const MAX_FILE_SIZE_MB = 2048 // 2GB

/* ── Helpers ────────────────────────────────────────── */

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${((bytes / 1024)).toFixed(1)} KB`
    return `${((bytes / (1024 * 1024))).toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
}

function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase()
    switch (ext) {
        case 'wav': return '◈'
        case 'mp3': return '◆'
        case 'ogg': return '◇'
        case 'flac': return '◎'
        case 'webm': return '◉'
        case 'm4a':
        case 'mp4': return '◍'
        default: return '◌'
    }
}

/* ── Component ──────────────────────────────────────── */

export default function TranscribirPage() {
    const router = useRouter()
    const { logout, user } = useAuthStore()

    useEffect(() => {
        if (user?.rol === 'admin') {
            router.replace('/admin')
        }
    }, [user, router])

    const fileInputRef = useRef<HTMLInputElement>(null)

    const [phase, setPhase] = useState<UploadPhase>('idle')
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [dragActive, setDragActive] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<TranscriptionResult | null>(null)
    const [progress, setProgress] = useState(0)

    // Form fields
    const [expediente, setExpediente] = useState('')
    const [juzgado, setJuzgado] = useState('')
    const [tipoAudiencia, setTipoAudiencia] = useState('Audiencia General')
    const [instancia, setInstancia] = useState('Primera Instancia')

    const handleFileSelect = useCallback((file: File) => {
        setError(null)
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            setError(`El archivo es demasiado grande. Máximo: 2GB`)
            return
        }
        const ext = file.name.split('.').pop()?.toLowerCase()
        const validExts = ['wav', 'mp3', 'mp4', 'm4a', 'ogg', 'webm', 'flac', 'aac']
        if (!ext || !validExts.includes(ext)) {
            setError(`Formato no soportado. Acepta: WAV, MP3, MP4, M4A, OGG, WebM, FLAC, AAC`)
            return
        }
        setSelectedFile(file)
        setPhase('selected')
    }, [])

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) handleFileSelect(file)
    }, [handleFileSelect])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragActive(false)
        const file = e.dataTransfer.files?.[0]
        if (file) handleFileSelect(file)
    }, [handleFileSelect])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragActive(true)
    }, [])

    const handleDragLeave = useCallback(() => {
        setDragActive(false)
    }, [])

    const handleRemoveFile = useCallback(() => {
        setSelectedFile(null)
        setPhase('idle')
        setError(null)
        setResult(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }, [])

    const handleTranscribe = async () => {
        if (!selectedFile || !expediente.trim() || !juzgado.trim()) {
            setError('Completa los campos obligatorios: Expediente y Juzgado')
            return
        }
        setPhase('uploading')
        setError(null)
        setProgress(0)
        let activeInterval: ReturnType<typeof setInterval> | null = null
        let transcribingStarted = false

        const startTranscribingPhase = () => {
            if (transcribingStarted) return
            transcribingStarted = true
            setPhase('transcribing')
            setProgress(30)
            let p = 30
            activeInterval = setInterval(() => {
                p = Math.min(p + 1, 94)
                setProgress(p)
            }, 3000)
        }

        // Si onUploadProgress no dispara (upload instantáneo o total desconocido),
        // transicionar a 'transcribing' después de 3 segundos de todas formas.
        const uploadFallbackTimer = setTimeout(startTranscribingPhase, 3000)

        try {
            const formData = new FormData()
            formData.append('audio', selectedFile)
            formData.append('expediente', expediente.trim())
            formData.append('juzgado', juzgado.trim())
            formData.append('tipo_audiencia', tipoAudiencia)
            formData.append('instancia', instancia)

            const { data } = await api.post('/api/transcripcion-audio', formData, {
                headers: { 'Content-Type': undefined },
                timeout: 1200000,
                onUploadProgress: (progressEvent) => {
                    clearTimeout(uploadFallbackTimer)
                    const total = progressEvent.total || 0
                    if (total > 0) {
                        const pct = Math.round((progressEvent.loaded / total) * 30)
                        setProgress(pct)
                        if (progressEvent.loaded >= total) startTranscribingPhase()
                    } else {
                        // total desconocido pero bytes fluyendo → transicionar ya
                        if (progressEvent.loaded > 0) startTranscribingPhase()
                    }
                },
            })

            clearTimeout(uploadFallbackTimer)
            if (activeInterval) clearInterval(activeInterval)
            setProgress(100)
            setResult(data)
            setPhase('done')
        } catch (err: any) {
            clearTimeout(uploadFallbackTimer)
            if (activeInterval) clearInterval(activeInterval)
            setPhase('error')
            setError(err.response?.data?.detail || err.message || 'Error al procesar el audio.')
        }
    }

    const handleViewAudiencia = () => {
        if (result?.audiencia_id) {
            window.location.href = `/audiencia/${result.audiencia_id}`
        }
    }

    const handleNewUpload = () => {
        setSelectedFile(null)
        setPhase('idle')
        setError(null)
        setResult(null)
        setProgress(0)
        setExpediente('')
        setJuzgado('')
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    return (
        <AuthGuard>
            <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
                <header className="px-4 sm:px-8 py-4 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-4"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center gap-4">
                        <div className="logo-monogram shrink-0 cursor-pointer" onClick={() => window.location.href = '/'}>J</div>
                        <div>
                            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)]">Transcripción de Audio</h1>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => window.location.href = '/'} className="btn-secondary text-xs">Dashboard</button>
                        <button onClick={() => { logout(); window.location.href = '/login' }} className="btn-secondary text-xs">Salir</button>
                    </div>
                </header>

                <main className="max-w-3xl mx-auto px-4 py-8">
                    {phase === 'idle' && (
                        <div className="upload-dropzone" 
                             onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                             onClick={() => fileInputRef.current?.click()}>
                            <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} onChange={handleInputChange} className="hidden" />
                            <p className="upload-dropzone__title">Arrastra tu audio aquí</p>
                            <p className="text-xs text-[var(--text-muted)] mt-2">WAV, MP3, M4A, FLAC, OGG hasta 2GB</p>
                        </div>
                    )}

                    {phase === 'selected' && selectedFile && (
                        <div className="upload-form">
                            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl mb-6">
                                <span className="text-2xl">🎵</span>
                                <div className="flex-1">
                                    <p className="text-sm font-bold">{selectedFile.name}</p>
                                    <p className="text-xs text-gray-500">{formatFileSize(selectedFile.size)}</p>
                                </div>
                                <button onClick={handleRemoveFile} className="text-red-500">✕</button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Expediente *</label>
                                    <input type="text" value={expediente} onChange={e => setExpediente(e.target.value)} className="w-full p-3 rounded-xl border border-gray-200" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Juzgado *</label>
                                    <input type="text" value={juzgado} onChange={e => setJuzgado(e.target.value)} className="w-full p-3 rounded-xl border border-gray-200" />
                                </div>
                                <button onClick={handleTranscribe} disabled={!expediente.trim() || !juzgado.trim()} className="btn-primary w-full py-4">
                                    Comenzar Transcripción
                                </button>
                            </div>
                        </div>
                    )}

                    {(phase === 'uploading' || phase === 'transcribing') && (
                        <div className="text-center py-12">
                            <div className="w-12 h-12 border-4 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                            <h3 className="font-bold text-lg">{phase === 'uploading' ? 'Subiendo...' : 'Procesando...'}</h3>
                            <div className="w-full bg-gray-100 h-2 rounded-full mt-6 overflow-hidden">
                                <div className="bg-[var(--accent-gold)] h-full transition-all" style={{ width: `${progress}%` }} />
                            </div>
                            <p className="text-xs mt-2">{progress}%</p>
                        </div>
                    )}

                    {phase === 'done' && result && (
                        <div className="text-center py-8">
                            <div className="text-4xl mb-4">✅</div>
                            <h3 className="font-bold text-xl mb-2">¡Listo!</h3>
                            <p className="text-sm text-gray-600 mb-8">{result.mensaje}</p>
                            <div className="flex gap-4 justify-center">
                                <button onClick={handleViewAudiencia} className="btn-primary px-8">Ver Resultado</button>
                                <button onClick={handleNewUpload} className="btn-secondary">Subir otro</button>
                            </div>
                        </div>
                    )}

                    {error && <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm mt-6">{error}</div>}
                </main>
            </div>
        </AuthGuard>
    )
}
