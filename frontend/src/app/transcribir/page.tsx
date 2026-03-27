'use client'

/**
 * Transcribir — Página de carga y edición de audio.
 *
 * Fases:
 *   idle      → dropzone para arrastrar/seleccionar archivo
 *   selected  → formulario con campos de audiencia
 *   uploading → barra de progreso de subida
 *   editando  → editor de audio full-width (AudioEditorPre)
 *   done      → resultado con enlace a la audiencia
 *   error     → mensaje con opción de reintentar
 */
import { useCallback, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuthStore } from '@/stores/authStore'
import AudioEditorPre, { ProcesarResult } from '@/components/audio/AudioEditorPre'

type UploadPhase = 'idle' | 'selected' | 'uploading' | 'editando' | 'done' | 'error'

interface EditandoData { audienciaId: string; duracion: number }

const ACCEPTED = '.wav,.mp3,.mp4,.m4a,.ogg,.webm,.flac,.aac'
const VALID_EXTS = ['wav', 'mp3', 'mp4', 'm4a', 'ogg', 'webm', 'flac', 'aac']

function fmtBytes(b: number) {
    if (b < 1024) return `${b} B`
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 ** 2).toFixed(1)} MB`
}

/* ── Icono audio ─────────────────────────────────────────────────────────── */
function AudioIcon({ size = 40 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
        </svg>
    )
}

/* ── Main ────────────────────────────────────────────────────────────────── */
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
    const [result, setResult] = useState<ProcesarResult | null>(null)

    const [expediente, setExpediente] = useState('')
    const [juzgado, setJuzgado] = useState('')
    const [tipo, setTipo] = useState('Audiencia General')
    const [instancia, setInstancia] = useState('Primera Instancia')

    const selectFile = useCallback((f: File) => {
        setError(null)
        if (f.size > 2 * 1024 ** 3) { setError('El archivo es demasiado grande. Máximo: 2GB'); return }
        const ext = f.name.split('.').pop()?.toLowerCase()
        if (!ext || !VALID_EXTS.includes(ext)) {
            setError('Formato no soportado. Se acepta: WAV, MP3, MP4, M4A, OGG, WebM, FLAC, AAC')
            return
        }
        setFile(f)
        setPhase('selected')
    }, [])

    const handleSubir = async () => {
        if (!file || !expediente.trim() || !juzgado.trim()) {
            setError('Completa Expediente y Juzgado')
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
                timeout: 300_000,
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
            setError(err.response?.data?.detail || err.message || 'Error al subir el audio.')
        }
    }

    const handleProcesado = useCallback((res: ProcesarResult) => {
        setResult(res)
        setPhase('done')
    }, [])

    const reset = () => {
        setFile(null); setPhase('idle'); setError(null); setResult(null)
        setEditando(null); setProgress(0); setExpediente(''); setJuzgado('')
        if (fileRef.current) fileRef.current.value = ''
    }

    const inEditor = phase === 'editando'

    return (
        <AuthGuard>
            <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>

                {/* ── Header ── */}
                <header style={{
                    padding: '14px 24px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'var(--bg-primary)', position: 'sticky', top: 0, zIndex: 50,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div className="logo-monogram shrink-0 cursor-pointer" onClick={() => router.push('/')}
                            style={{ width: 34, height: 34, fontSize: 15 }}>J</div>
                        <div>
                            <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                                {inEditor && editando
                                    ? `Editando: ${file?.name ?? 'audio'}`
                                    : 'Transcripción de Audio'}
                            </h1>
                            {inEditor && editando && (
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    Recorta, filtra y transcribe — solo se envía lo que selecciones
                                </p>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {inEditor && (
                            <button onClick={reset} className="btn-secondary" style={{ fontSize: 12 }}>
                                ← Cancelar
                            </button>
                        )}
                        <button onClick={() => router.push('/')} className="btn-secondary" style={{ fontSize: 12 }}>
                            Dashboard
                        </button>
                        <button onClick={async () => { await logout(); router.push('/login') }}
                            className="btn-secondary" style={{ fontSize: 12 }}>
                            Salir
                        </button>
                    </div>
                </header>

                {/* ── Main ── */}
                <main style={{
                    flex: 1,
                    width: '100%',
                    maxWidth: inEditor ? '1280px' : '680px',
                    margin: '0 auto',
                    padding: inEditor ? '24px 24px' : '40px 24px',
                    boxSizing: 'border-box',
                }}>

                    {/* ── IDLE: dropzone ── */}
                    {phase === 'idle' && (
                        <div
                            className="upload-dropzone"
                            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) selectFile(f) }}
                            onDragOver={e => { e.preventDefault(); setDrag(true) }}
                            onDragLeave={() => setDrag(false)}
                            onClick={() => fileRef.current?.click()}
                            style={{
                                borderColor: drag ? 'var(--accent-primary)' : undefined,
                                background: drag ? 'rgba(37,99,235,0.04)' : undefined,
                                minHeight: 220, cursor: 'pointer',
                            }}
                        >
                            <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) selectFile(f) }} />
                            <div style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                                <AudioIcon size={48} />
                            </div>
                            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                                Arrastra tu audio aquí
                            </p>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                                WAV · MP3 · M4A · FLAC · OGG · WebM · AAC — hasta 2 GB
                            </p>
                            <button className="btn-secondary" style={{ fontSize: 13, pointerEvents: 'none' }}>
                                o selecciona archivo
                            </button>
                        </div>
                    )}

                    {/* ── SELECTED: formulario ── */}
                    {phase === 'selected' && file && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Tarjeta del archivo */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 14,
                                padding: '14px 18px', borderRadius: 12,
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-subtle)',
                            }}>
                                <div style={{
                                    width: 44, height: 44, borderRadius: 10,
                                    background: 'rgba(37,99,235,0.1)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'var(--accent-primary)', flexShrink: 0,
                                }}>
                                    <AudioIcon size={22} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {file.name}
                                    </p>
                                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtBytes(file.size)}</p>
                                </div>
                                <button onClick={reset} style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--text-muted)', fontSize: 18, padding: 4,
                                }}>×</button>
                            </div>

                            {/* Formulario */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <Field label="Expediente *" placeholder="Ej: 00123-2024-0-1001-JR-PE-01"
                                    value={expediente} onChange={setExpediente} />
                                <Field label="Juzgado *" placeholder="Ej: Juzgado Penal de Cusco"
                                    value={juzgado} onChange={setJuzgado} />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                    <SelectField label="Tipo de Audiencia" value={tipo} onChange={setTipo}
                                        options={['Audiencia General', 'Audiencia Preliminar', 'Juicio Oral', 'Audiencia de Control', 'Audiencia de Apelación']} />
                                    <SelectField label="Instancia" value={instancia} onChange={setInstancia}
                                        options={['Primera Instancia', 'Segunda Instancia', 'Sala Suprema']} />
                                </div>

                                {error && (
                                    <p style={{ fontSize: 13, color: '#dc2626', padding: '8px 12px', background: 'rgba(220,38,38,0.08)', borderRadius: 8 }}>
                                        {error}
                                    </p>
                                )}

                                <button onClick={handleSubir}
                                    disabled={!expediente.trim() || !juzgado.trim()}
                                    className="btn-primary"
                                    style={{ padding: '14px 0', fontSize: 15, opacity: (!expediente.trim() || !juzgado.trim()) ? 0.5 : 1 }}>
                                    Subir y editar audio →
                                </button>
                                <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                                    El audio se optimiza automáticamente — el original pesado se elimina al subir
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── UPLOADING ── */}
                    {phase === 'uploading' && (
                        <div style={{ textAlign: 'center', padding: '60px 0' }}>
                            <div style={{
                                width: 60, height: 60, borderRadius: '50%',
                                border: '4px solid var(--border-subtle)',
                                borderTopColor: 'var(--accent-gold)',
                                animation: 'spin 0.9s linear infinite',
                                margin: '0 auto 20px',
                            }} />
                            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                                Subiendo audio...
                            </h3>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                                {progress < 100
                                    ? 'Transfiriendo archivo al servidor'
                                    : 'Optimizando y guardando...'}
                            </p>
                            <div style={{ width: '100%', maxWidth: 340, margin: '0 auto' }}>
                                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%', borderRadius: 3,
                                        width: `${progress}%`,
                                        background: 'var(--accent-gold)',
                                        transition: 'width 0.3s ease',
                                    }} />
                                </div>
                                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{progress}%</p>
                            </div>
                        </div>
                    )}

                    {/* ── EDITANDO: layout full-width ── */}
                    {phase === 'editando' && editando && (
                        <AudioEditorPre
                            audienciaId={editando.audienciaId}
                            duracion={editando.duracion}
                            filename={file?.name}
                            onProcesado={handleProcesado}
                            onCancelar={reset}
                        />
                    )}

                    {/* ── DONE ── */}
                    {phase === 'done' && result && (
                        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                            <div style={{
                                width: 72, height: 72, borderRadius: '50%',
                                background: 'rgba(22,163,74,0.12)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 20px',
                            }}>
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            </div>
                            <h3 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                                Transcripción completa
                            </h3>
                            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>
                                {result.mensaje}
                            </p>
                            <div style={{
                                display: 'inline-flex', gap: 32, padding: '14px 28px',
                                borderRadius: 12, background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-subtle)', marginBottom: 32,
                            }}>
                                <Stat label="Segmentos" value={result.total_segmentos} />
                                <Stat label="Hablantes" value={result.hablantes_detectados} />
                                {result.costo_total_usd > 0 && (
                                    <Stat label="Costo (USD)" value={`$${result.costo_total_usd.toFixed(4)}` as any} />
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                                <button onClick={() => router.push(`/audiencia/${result.audiencia_id}`)} className="btn-primary" style={{ padding: '12px 32px' }}>
                                    Ver transcripción →
                                </button>
                                <button onClick={reset} className="btn-secondary">
                                    Subir otro audio
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── ERROR ── */}
                    {phase === 'error' && error && (
                        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                            <div style={{
                                width: 64, height: 64, borderRadius: '50%',
                                background: 'rgba(220,38,38,0.1)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 20px',
                            }}>
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                            </div>
                            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Error al procesar</h3>
                            <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>{error}</p>
                            <button onClick={reset} className="btn-secondary">Intentar de nuevo</button>
                        </div>
                    )}

                </main>
            </div>
        </AuthGuard>
    )
}

/* ── Pequeños componentes de UI ─────────────────────────────────────────── */

function Field({ label, placeholder, value, onChange }: {
    label: string; placeholder: string; value: string; onChange: (v: string) => void
}) {
    return (
        <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                {label}
            </label>
            <input
                type="text" placeholder={placeholder} value={value}
                onChange={e => onChange(e.target.value)}
                style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                    border: '1.5px solid var(--border-subtle)',
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14,
                    outline: 'none', transition: 'border-color 0.15s',
                }}
            />
        </div>
    )
}

function SelectField({ label, value, onChange, options }: {
    label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
    return (
        <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                {label}
            </label>
            <select value={value} onChange={e => onChange(e.target.value)} style={{
                width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1.5px solid var(--border-subtle)',
                background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14,
                outline: 'none', cursor: 'pointer',
            }}>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
        </div>
    )
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{label}</p>
        </div>
    )
}
