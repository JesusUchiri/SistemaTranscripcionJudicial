'use client'

/**
 * PanelHablantes — Panel lateral para gestionar los hablantes de una audiencia.
 * 
 * Muestra los speaker_id detectados automáticamente por Deepgram y permite
 * al digitador asignar roles judiciales (juez, fiscal, defensa, etc.).
 * Al cambiar el rol, la etiqueta y color se propagan al Canvas.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import api from '@/lib/api'
import { SPEAKER_ROLES, type SpeakerRole } from '@/types'

interface Hablante {
    id: string
    speaker_id: string
    rol: string
    etiqueta: string
    nombre: string | null
    color: string
    orden: number
    auto_detectado: boolean
}

interface InferenciaSugerencia {
    speaker_id: string
    rol_sugerido: string
    etiqueta_sugerida: string
    color_sugerido: string
    confianza: number
    razon: string
}

interface PanelHablantesProps {
    audienciaId: string
    /** IDs de speakers detectados en la sesión actual (Deepgram) */
    speakersDetectados: string[]
    /** Callback cuando se actualiza un hablante */
    onHablanteActualizado?: (hablante: Hablante) => void
    /** Callback cuando se carga la lista completa */
    onHablantesCargados?: (hablantes: Hablante[]) => void
    /** ID del hablante que está hablando actualmente (provisionalSpeaker) */
    hablandoAhora?: string | null
    /** Si true, no llama a la API y gestiona todo localmente */
    modoDemo?: boolean
    /** Hablantes pre-cargados para modo demo */
    hablantesIniciales?: Hablante[]
}

export default function PanelHablantes({
    audienciaId,
    speakersDetectados,
    onHablanteActualizado,
    onHablantesCargados,
    hablandoAhora = null,
    modoDemo = false,
    hablantesIniciales = [],
}: PanelHablantesProps) {
    const [hablantes, setHablantes] = useState<Hablante[]>(hablantesIniciales)
    const [editando, setEditando] = useState<string | null>(null)
    const [cargando, setCargando] = useState(false)
    const creandoRef = useRef<Set<string>>(new Set())
    const [inferencias, setInferencias] = useState<InferenciaSugerencia[] | null>(null)
    const [infiriendoRoles, setInfiriendoRoles] = useState(false)
    const [errorInferencia, setErrorInferencia] = useState<string | null>(null)

    // Cargar hablantes existentes (solo si NO es demo)
    useEffect(() => {
        if (!modoDemo) {
            cargarHablantes()
        }
    }, [audienciaId, modoDemo])

    // Actualizar hablantes iniciales si cambian (para demo)
    useEffect(() => {
        if (modoDemo && hablantesIniciales.length > 0) {
            // Merge con los actuales para no perder ediciones locales
            setHablantes(prev => {
                const map = new Map(prev.map(h => [h.speaker_id, h]))
                const updated = hablantesIniciales.map(h => map.get(h.speaker_id) || h)
                onHablantesCargados?.(updated)
                return updated
            })
        }
    }, [hablantesIniciales, modoDemo, onHablantesCargados])
    // Auto-crear hablantes cuando se detectan nuevos speakers
    useEffect(() => {
        if (speakersDetectados.length === 0) return
        
        const idsExistentes = hablantes.map((h) => h.speaker_id)
        const nuevos = speakersDetectados.filter((id) => 
            !idsExistentes.includes(id) && !creandoRef.current.has(id)
        )

        if (nuevos.length > 0) {
            nuevos.forEach(id => creandoRef.current.add(id))
            
            if (modoDemo) {
                // Modo demo: añadir localmente
                const nuevosHablantes: Hablante[] = nuevos.map((id, idx) => ({
                    id: `demo-${Date.now()}-${idx}`,
                    speaker_id: id,
                    rol: 'otro',
                    etiqueta: `${id}:`,
                    nombre: '',
                    color: '#94A3B8',
                    orden: hablantes.length + idx,
                    auto_detectado: true
                }))
                setHablantes(prev => [...prev, ...nuevosHablantes])
                nuevos.forEach(id => creandoRef.current.delete(id))
            } else {
                // Modo API: POST — ignorar 409 (ya existe)
                Promise.all(
                    nuevos.map((speakerId, idx) =>
                        api.post(`/api/audiencias/${audienciaId}/hablantes`, {
                            speaker_id: speakerId,
                            rol: 'otro',
                            orden: hablantes.length + idx,
                        }).finally(() => {
                            creandoRef.current.delete(speakerId)
                        }).catch((err) => {
                            if (err?.response?.status !== 409) throw err
                            // 409 = ya existe, no es error
                        })
                    )
                ).then(() => cargarHablantes())
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speakersDetectados, audienciaId, modoDemo, hablantes])

    const cargarHablantes = async () => {
        try {
            const { data } = await api.get(`/api/audiencias/${audienciaId}/hablantes`)
            setHablantes(data)
            onHablantesCargados?.(data)
        } catch (err) {
            console.error('Error cargando hablantes:', err)
        }
    }

    const actualizarRol = async (hablanteId: string, nuevoRol: string) => {
        if (modoDemo) {
            const rolConfig = SPEAKER_ROLES.find(r => r.key === nuevoRol)
            setHablantes(prev => {
                const updated = prev.map(h =>
                    h.id === hablanteId
                        ? {
                            ...h,
                            rol: nuevoRol,
                            etiqueta: rolConfig?.etiqueta || nuevoRol.toUpperCase(),
                            color: rolConfig?.color || h.color,
                        }
                        : h
                )
                const changed = updated.find(h => h.id === hablanteId)
                if (changed) onHablanteActualizado?.(changed)
                return updated
            })
            return
        }

        setCargando(true)
        try {
            const { data } = await api.put(
                `/api/audiencias/${audienciaId}/hablantes/${hablanteId}`,
                { rol: nuevoRol }
            )
            setHablantes((prev) =>
                prev.map((h) => (h.id === hablanteId ? data : h))
            )
            onHablanteActualizado?.(data)
            setEditando(null)
        } catch (err) {
            console.error('Error actualizando hablante:', err)
        } finally {
            setCargando(false)
        }
    }

    const actualizarNombre = async (hablanteId: string, nombre: string) => {
        if (modoDemo) {
            setHablantes(prev => {
                const updated = prev.map(h =>
                    h.id === hablanteId ? { ...h, nombre } : h
                )
                const changed = updated.find(h => h.id === hablanteId)
                if (changed) onHablanteActualizado?.(changed)
                return updated
            })
            return
        }

        try {
            const { data } = await api.put(
                `/api/audiencias/${audienciaId}/hablantes/${hablanteId}`,
                { nombre }
            )
            setHablantes((prev) =>
                prev.map((h) => (h.id === hablanteId ? data : h))
            )
            onHablanteActualizado?.(data)
        } catch (err) {
            console.error('Error actualizando nombre:', err)
        }
    }

    const inferirRoles = async () => {
        if (modoDemo) return
        setInfiriendoRoles(true)
        setErrorInferencia(null)
        setInferencias(null)
        try {
            const { data } = await api.post<InferenciaSugerencia[]>(
                `/api/audiencias/${audienciaId}/hablantes/inferir-roles`
            )
            setInferencias(data)
        } catch (err: any) {
            const msg = err?.response?.data?.detail || 'Error al inferir roles'
            setErrorInferencia(msg)
        } finally {
            setInfiriendoRoles(false)
        }
    }

    const aceptarInferencia = async (sug: InferenciaSugerencia) => {
        const hablante = hablantes.find(h => h.speaker_id === sug.speaker_id)
        if (!hablante) return
        await actualizarRol(hablante.id, sug.rol_sugerido)
        // Remove this suggestion from the list
        setInferencias(prev => prev ? prev.filter(s => s.speaker_id !== sug.speaker_id) : null)
    }

    const rechazarInferencia = (speakerId: string) => {
        setInferencias(prev => prev ? prev.filter(s => s.speaker_id !== speakerId) : null)
    }

    return (
        <div className="p-4 space-y-4">
            <h3
                className="text-[10px] font-bold uppercase tracking-widest mb-4 flex items-center justify-between"
                style={{ color: 'var(--text-muted)' }}
            >
                Registro de Hablantes
                <div className="flex items-center gap-2">
                    {!modoDemo && hablantes.length > 0 && (
                        <button
                            onClick={inferirRoles}
                            disabled={infiriendoRoles}
                            title="Usa IA para sugerir el rol judicial de cada hablante según el contexto de la transcripción"
                            className="flex items-center gap-1 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider transition-all hover:brightness-110 disabled:opacity-60"
                            style={{
                                background: infiriendoRoles ? 'var(--bg-surface)' : 'var(--accent-gold-soft)',
                                border: '1px solid rgba(166,130,70,0.3)',
                                color: 'var(--accent-gold)',
                            }}
                        >
                            {infiriendoRoles ? (
                                <>
                                    <span className="w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" />
                                    Analizando...
                                </>
                            ) : (
                                <>
                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/><path d="M18 2l4 4-4 4"/>
                                    </svg>
                                    Inferir Roles
                                </>
                            )}
                        </button>
                    )}
                    <span className="px-2 py-0.5 bg-accent-soft text-accent-gold border border-accent-gold/20">{hablantes.length}</span>
                </div>
            </h3>

            {/* Sugerencias de inferencia */}
            {inferencias && inferencias.length > 0 && (
                <div
                    className="p-3 space-y-2 rounded-[1px]"
                    style={{ background: 'rgba(166,130,70,0.06)', border: '1px solid rgba(166,130,70,0.2)' }}
                >
                    <p className="text-[8px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--accent-gold)' }}>
                        Sugerencias de IA — Acepta o rechaza cada una
                    </p>
                    {inferencias.map(sug => (
                        <div
                            key={sug.speaker_id}
                            className="flex items-start gap-2 p-2 rounded-[1px]"
                            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                        >
                            <div
                                className="w-1 self-stretch shrink-0 rounded-full"
                                style={{ background: sug.color_sugerido }}
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1 mb-0.5">
                                    <span className="text-[9px] font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                                        {sug.speaker_id}
                                    </span>
                                    <span
                                        className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5"
                                        style={{ background: `${sug.color_sugerido}22`, color: sug.color_sugerido }}
                                    >
                                        {sug.rol_sugerido}
                                    </span>
                                    <span
                                        className="ml-auto text-[8px] font-medium"
                                        style={{ color: sug.confianza >= 0.85 ? '#22C55E' : sug.confianza >= 0.6 ? '#F59E0B' : 'var(--text-muted)' }}
                                    >
                                        {Math.round(sug.confianza * 100)}%
                                    </span>
                                </div>
                                <p className="text-[9px] leading-tight mb-2" style={{ color: 'var(--text-muted)' }}>
                                    {sug.razon}
                                </p>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => aceptarInferencia(sug)}
                                        disabled={cargando}
                                        className="flex-1 py-1 text-[8px] font-bold uppercase tracking-wider transition-all hover:brightness-110"
                                        style={{
                                            background: 'rgba(34,197,94,0.1)',
                                            border: '1px solid rgba(34,197,94,0.25)',
                                            color: '#22C55E',
                                        }}
                                    >
                                        Aceptar
                                    </button>
                                    <button
                                        onClick={() => rechazarInferencia(sug.speaker_id)}
                                        className="flex-1 py-1 text-[8px] font-bold uppercase tracking-wider transition-all hover:brightness-110"
                                        style={{
                                            background: 'rgba(155,34,38,0.07)',
                                            border: '1px solid rgba(155,34,38,0.2)',
                                            color: 'var(--danger)',
                                        }}
                                    >
                                        Rechazar
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {inferencias && inferencias.length === 0 && (
                <p className="text-[9px] text-center py-2" style={{ color: 'var(--text-muted)' }}>
                    Todas las sugerencias procesadas.
                </p>
            )}
            {errorInferencia && (
                <p className="text-[9px] px-2 py-1.5" style={{ color: 'var(--danger)', background: 'rgba(155,34,38,0.07)', border: '1px solid rgba(155,34,38,0.2)' }}>
                    {errorInferencia}
                </p>
            )}

            {hablantes.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-border-default rounded-[1px]">
                    <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        Esperando detección de locutores por el motor Novum Nova-3...
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {hablantes.map((h) => (
                        <div
                            key={h.id}
                            className="p-4 transition-all relative overflow-hidden"
                            style={{
                                background: 'var(--bg-surface)',
                                border: editando === h.id
                                    ? `1px solid ${h.color}`
                                    : '1px solid var(--border-subtle)',
                                borderRadius: '1px'
                            }}
                        >
                            {/* Accent line */}
                            <div className="absolute top-0 left-0 w-[3px] h-full" style={{ background: h.color }} />

                            {/* Encabezado: speaker_id + auto tag + hablando ahora */}
                            <div className="flex items-center justify-between mb-3 pl-1">
                                <div className="flex items-center gap-2">
                                    <span
                                        className="text-[11px] font-mono font-bold tracking-tighter"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        ID: {h.speaker_id}
                                    </span>
                                    {hablandoAhora === h.speaker_id && (
                                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(219, 39, 119, 0.1)' }}>
                                            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#DB2777' }} />
                                            <span className="text-[8px] font-bold uppercase tracking-widest text-pink-500">
                                                Al aire
                                            </span>
                                        </div>
                                    )}
                                </div>
                                {h.auto_detectado && (
                                    <span
                                        className="text-[9px] font-bold uppercase tracking-tighter px-1.5 py-0.5"
                                        style={{
                                            background: 'var(--accent-gold-soft)',
                                            color: 'var(--accent-gold)',
                                        }}
                                    >
                                        AUTO
                                    </span>
                                )}
                            </div>

                            {/* Selector de rol */}
                            <div className="space-y-1 mb-3 pl-1">
                                <label className="block text-[9px] font-bold uppercase tracking-widest opacity-50">Rol Judicial</label>
                                <select
                                    value={h.rol}
                                    onChange={(e) => actualizarRol(h.id, e.target.value)}
                                    onFocus={() => setEditando(h.id)}
                                    onBlur={() => setEditando(null)}
                                    disabled={cargando}
                                    className="w-full px-2 py-2 text-[11px] font-bold uppercase tracking-wide outline-none transition-colors border border-border-default focus:border-accent-gold"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        color: 'var(--text-primary)',
                                    }}
                                >
                                    {SPEAKER_ROLES.map((rol) => (
                                        <option key={rol.id} value={rol.key}>
                                            {rol.rol.toUpperCase()}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Nombre (editable) */}
                            <div className="space-y-1 pl-1">
                                <label className="block text-[9px] font-bold uppercase tracking-widest opacity-50">Identidad</label>
                                <input
                                    type="text"
                                    value={h.nombre || ''}
                                    onChange={(e) => actualizarNombre(h.id, e.target.value)}
                                    placeholder="Nombre completo..."
                                    className="w-full px-2 py-2 text-[11px] font-medium outline-none border-b border-border-subtle focus:border-accent-gold"
                                    style={{
                                        background: 'transparent',
                                        color: 'var(--text-secondary)',
                                    }}
                                />
                            </div>

                            {/* Etiqueta final */}
                            <div className="mt-3 pt-2 border-t border-border-subtle/30 flex justify-end">
                                <p
                                    className="text-[9px] font-black uppercase tracking-[0.2em]"
                                    style={{ color: h.color }}
                                >
                                    {h.etiqueta}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
