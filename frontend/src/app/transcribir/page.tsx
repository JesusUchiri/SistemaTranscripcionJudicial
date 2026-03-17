'use client'

/**
 * Página de transcripción de audio — Subir archivos pregrabados.
 *
 * Permite subir archivos de audio (WAV, MP3, OGG, etc.) y procesarlos
 * con Deepgram batch API para obtener la transcripción completa con
 * diarización de hablantes.
 */
import { useCallback, useRef, useState } from 'react'
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
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
    const { logout } = useAuthStore()
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

    /* ── File handling ──────────────────────────────── */

    const handleFileSelect = useCallback((file: File) => {
        setError(null)

        // Validate size
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            setError(`El archivo es demasiado grande. Máximo: 2GB`)
            return
        }

        // Validate extension
        const ext = file.name.split('.').pop()?.toLowerCase()
        const validExts = ['wav', 'mp3', 'mp4', 'm4a', 'ogg', 'webm', 'flac', 'aac']
        if (!ext || !validExts.includes(ext)) {
            setError(`Formato no soportado: .${ext}. Acepta: WAV, MP3, MP4, M4A, OGG, WebM, FLAC, AAC`)
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

    /* ── Upload & Transcribe ───────────────────────── */

    const handleTranscribe = async () => {
        if (!selectedFile || !expediente.trim() || !juzgado.trim()) {
            setError('Completa los campos obligatorios: Expediente y Juzgado')
            return
        }

        setPhase('uploading')
        setError(null)
        setProgress(0)

        try {
            const formData = new FormData()
            formData.append('audio', selectedFile)
            formData.append('expediente', expediente.trim())
            formData.append('juzgado', juzgado.trim())
            formData.append('tipo_audiencia', tipoAudiencia)
            formData.append('instancia', instancia)

            // Simulate upload progress
            const progressInterval = setInterval(() => {
                setProgress(prev => {
                    if (prev < 30) return prev + 2
                    return prev
                })
            }, 100)

            setPhase('uploading')

            const { data } = await api.post('/api/transcripcion-audio', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 1200000, // 20 min — suficiente para archivos de 5h+
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.total) {
                        const pct = Math.round((progressEvent.loaded / progressEvent.total) * 30)
                        setProgress(pct)
                    }
                },
            })

            clearInterval(progressInterval)

            // Transcription phase
            setPhase('transcribing')
            // Simulate transcription progress
            let transcProg = 30
            const transcInterval = setInterval(() => {
                transcProg += 1
                setProgress(Math.min(transcProg, 95))
            }, 200)

            // The request already returned the result, so we just show it
            clearInterval(transcInterval)
            setProgress(100)
            setResult(data)
            setPhase('done')
        } catch (err: unknown) {
            setPhase('error')
            const errMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                || 'Error al procesar el audio. Verifica el archivo e intenta nuevamente.'
            setError(errMsg)
        }
    }

    const handleViewAudiencia = () => {
        if (result?.audiencia_id) {
            router.push(`/audiencia/${result.audiencia_id}`)
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

    /* ── Render ─────────────────────────────────────── */

    const isProcessing = phase === 'uploading' || phase === 'transcribing'

    return (
        <AuthGuard>
            <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
                {/* Header */}
                <header className="px-4 sm:px-8 py-4 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-4"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center gap-4">
                        <div className="logo-monogram shrink-0 cursor-pointer" onClick={() => router.push('/')}>J</div>
                        <div>
                            <h1 className="text-lg sm:text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                                Transcripción de Audio
                            </h1>
                            <p className="text-xs sm:text-sm" style={{ color: 'var(--text-muted)' }}>Sube un archivo y obtén la transcripción completa</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                        <button onClick={() => router.push('/')} className="btn-secondary text-xs sm:text-sm">
                            Dashboard
                        </button>
                        <button
                            onClick={() => { logout(); router.push('/login') }}
                            className="btn-secondary text-xs sm:text-sm">
                            Salir
                        </button>
                    </div>
                </header>

                <main className="max-w-3xl mx-auto px-4 sm:px-8 py-8 sm:py-12">

                    {/* ── Upload Zone ─────────────────────── */}
                    {phase === 'idle' && (
                        <div className="animate-fade-in">
                            {/* Decorative element */}
                            <div className="upload-hero-accent" />

                            <div
                                className={`upload-dropzone ${dragActive ? 'upload-dropzone--active' : ''}`}
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={ACCEPTED_EXTENSIONS}
                                    onChange={handleInputChange}
                                    className="hidden"
                                />

                                <div className="upload-dropzone__icon">
                                    <div className="upload-dropzone__waveform">
                                        <span style={{ animationDelay: '0s' }} />
                                        <span style={{ animationDelay: '0.1s' }} />
                                        <span style={{ animationDelay: '0.2s' }} />
                                        <span style={{ animationDelay: '0.15s' }} />
                                        <span style={{ animationDelay: '0.25s' }} />
                                        <span style={{ animationDelay: '0.05s' }} />
                                        <span style={{ animationDelay: '0.3s' }} />
                                    </div>
                                </div>

                                <p className="upload-dropzone__title">
                                    Arrastra tu archivo de audio aquí
                                </p>
                                <p className="upload-dropzone__subtitle">
                                    o haz clic para seleccionar
                                </p>

                                <div className="upload-dropzone__formats">
                                    {['WAV', 'MP3', 'M4A', 'OGG', 'FLAC', 'WebM'].map(fmt => (
                                        <span key={fmt} className="upload-dropzone__format-tag">{fmt}</span>
                                    ))}
                                </div>

                                <p className="upload-dropzone__limit">
                                    Máximo 2GB · WAV, MP3, M4A, FLAC, OGG · hasta 5+ horas
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── File Selected — Form ───────────── */}
                    {phase === 'selected' && selectedFile && (
                        <div className="animate-fade-in">
                            {/* File Preview */}
                            <div className="upload-file-card">
                                <div className="upload-file-card__icon">
                                    {getFileIcon(selectedFile.name)}
                                </div>
                                <div className="upload-file-card__info">
                                    <p className="upload-file-card__name">{selectedFile.name}</p>
                                    <p className="upload-file-card__size">{formatFileSize(selectedFile.size)}</p>
                                </div>
                                <button onClick={handleRemoveFile} className="upload-file-card__remove" title="Quitar archivo">
                                    ✕
                                </button>
                            </div>

                            {/* Metadata Form */}
                            <div className="upload-form">
                                <h3 className="upload-form__title">Datos del expediente</h3>

                                <div className="upload-form__grid">
                                    <div className="upload-form__field">
                                        <label className="upload-form__label">
                                            Expediente <span className="upload-form__required">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={expediente}
                                            onChange={e => setExpediente(e.target.value)}
                                            placeholder="Ej: 00123-2026-0-1001-JR-PE-01"
                                            className="upload-form__input"
                                        />
                                    </div>

                                    <div className="upload-form__field">
                                        <label className="upload-form__label">
                                            Juzgado <span className="upload-form__required">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={juzgado}
                                            onChange={e => setJuzgado(e.target.value)}
                                            placeholder="Ej: Primer Juzgado Penal Unipersonal de Cusco"
                                            className="upload-form__input"
                                        />
                                    </div>

                                    <div className="upload-form__field">
                                        <label className="upload-form__label">Tipo de audiencia</label>
                                        <select
                                            value={tipoAudiencia}
                                            onChange={e => setTipoAudiencia(e.target.value)}
                                            className="upload-form__input"
                                        >
                                            <option>Audiencia General</option>
                                            <option>Juicio Oral</option>
                                            <option>Control de Acusación</option>
                                            <option>Prisión Preventiva</option>
                                            <option>Apelación de Sentencia</option>
                                            <option>Lectura de Sentencia</option>
                                            <option>Otro</option>
                                        </select>
                                    </div>

                                    <div className="upload-form__field">
                                        <label className="upload-form__label">Instancia</label>
                                        <select
                                            value={instancia}
                                            onChange={e => setInstancia(e.target.value)}
                                            className="upload-form__input"
                                        >
                                            <option>Primera Instancia</option>
                                            <option>Segunda Instancia</option>
                                            <option>Casación</option>
                                        </select>
                                    </div>
                                </div>

                                <button
                                    onClick={handleTranscribe}
                                    disabled={!expediente.trim() || !juzgado.trim()}
                                    className="btn-primary upload-form__submit"
                                >
                                    Transcribir audio
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Processing ─────────────────────── */}
                    {isProcessing && (
                        <div className="animate-fade-in">
                            <div className="upload-processing">
                                <div className="upload-processing__visual">
                                    <div className="upload-processing__rings">
                                        <div className="upload-processing__ring upload-processing__ring--outer" />
                                        <div className="upload-processing__ring upload-processing__ring--inner" />
                                        <div className="upload-processing__pulse" />
                                    </div>
                                </div>

                                <div className="upload-processing__info">
                                    <h3 className="upload-processing__title">
                                        {phase === 'uploading' ? 'Subiendo audio...' : 'Transcribiendo con IA...'}
                                    </h3>
                                    <p className="upload-processing__subtitle">
                                        {phase === 'uploading'
                                            ? 'Enviando el archivo al servidor'
                                            : 'Deepgram Nova-3 está procesando el audio con diarización de hablantes'
                                        }
                                    </p>
                                </div>

                                {/* Progress bar */}
                                <div className="upload-processing__progress">
                                    <div className="upload-processing__progress-track">
                                        <div
                                            className="upload-processing__progress-fill"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                    <span className="upload-processing__progress-label">{progress}%</span>
                                </div>

                                {selectedFile && (
                                    <div className="upload-processing__file-info">
                                        <span>{getFileIcon(selectedFile.name)}</span>
                                        <span>{selectedFile.name}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>·</span>
                                        <span style={{ color: 'var(--text-muted)' }}>{formatFileSize(selectedFile.size)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Done ───────────────────────────── */}
                    {phase === 'done' && result && (
                        <div className="animate-fade-in">
                            <div className="upload-result">
                                <div className="upload-result__check">
                                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                                        <circle cx="24" cy="24" r="24" fill="var(--success)" opacity="0.1" />
                                        <circle cx="24" cy="24" r="18" fill="var(--success)" opacity="0.15" />
                                        <path d="M16 24L22 30L33 19" stroke="var(--success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>

                                <h3 className="upload-result__title">Transcripción completada</h3>
                                <p className="upload-result__message">{result.mensaje}</p>

                                <div className="upload-result__stats">
                                    <div className="upload-result__stat">
                                        <span className="upload-result__stat-value">{result.total_segmentos}</span>
                                        <span className="upload-result__stat-label">Segmentos</span>
                                    </div>
                                    <div className="upload-result__stat-divider" />
                                    <div className="upload-result__stat">
                                        <span className="upload-result__stat-value">{result.hablantes_detectados}</span>
                                        <span className="upload-result__stat-label">Hablantes</span>
                                    </div>
                                    <div className="upload-result__stat-divider" />
                                    <div className="upload-result__stat">
                                        <span className="upload-result__stat-value">{formatDuration(result.duracion_segundos)}</span>
                                        <span className="upload-result__stat-label">Duración</span>
                                    </div>
                                </div>

                                <div className="upload-result__actions">
                                    <button
                                        onClick={handleViewAudiencia}
                                        className="btn-primary"
                                    >
                                        Ver transcripción
                                    </button>
                                    <button
                                        onClick={handleNewUpload}
                                        className="btn-secondary"
                                    >
                                        Subir otro audio
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Error ──────────────────────────── */}
                    {error && (
                        <div className="upload-error animate-fade-in">
                            <div className="upload-error__icon">!</div>
                            <p className="upload-error__text">{error}</p>
                            {phase === 'error' && (
                                <button onClick={handleNewUpload} className="btn-secondary" style={{ marginTop: '16px' }}>
                                    Intentar de nuevo
                                </button>
                            )}
                        </div>
                    )}

                </main>
            </div>
        </AuthGuard>
    )
}
