'use client'

/**
 * PanelVariables — Panel lateral para gestionar variables de la audiencia.
 *
 * Muestra todas las variables de plantilla ({{EXPEDIENTE}}, {{JUEZ}}, etc.)
 * con sus valores actuales. Cuando la transcripción detecta un nuevo valor,
 * aparece como sugerencia para aceptar o ignorar.
 *
 * También permite editar manualmente los valores y copiar el token {{VAR}}
 * para insertarlo en el acta.
 */
import { useState, useCallback } from 'react'
import api from '@/lib/api'
import { VARIABLES_DEF, toToken, valorDeAudiencia, type VariableDef } from '@/lib/variables'
import type { Audiencia } from '@/types'

export interface VariableDeteccion {
    key: string
    valorDetectado: string
    texto: string        // fragmento de transcripción donde se detectó
    timestamp: number
}

interface PanelVariablesProps {
    audiencia: Audiencia
    hablantes: Array<{ rol: string; nombre: string | null; etiqueta: string }>
    detecciones: VariableDeteccion[]
    onAceptarDeteccion: (det: VariableDeteccion) => void
    onRechazarDeteccion: (key: string) => void
    onAudienciaActualizada: (campos: Partial<Audiencia>) => void
}

const GRUPO_LABELS: Record<string, string> = {
    expediente: 'Expediente',
    personas:   'Personas',
    datos:      'Datos del caso',
    tiempo:     'Horario',
}

export default function PanelVariables({
    audiencia,
    hablantes,
    detecciones,
    onAceptarDeteccion,
    onRechazarDeteccion,
    onAudienciaActualizada,
}: PanelVariablesProps) {
    const [editando, setEditando] = useState<string | null>(null)
    const [valorEdit, setValorEdit] = useState('')
    const [copiado, setCopiado] = useState<string | null>(null)

    const getValor = useCallback((v: VariableDef) =>
        valorDeAudiencia(v, audiencia as any, hablantes),
        [audiencia, hablantes]
    )

    const copiarToken = (key: string) => {
        navigator.clipboard.writeText(toToken(key)).catch(() => {})
        setCopiado(key)
        setTimeout(() => setCopiado(null), 1500)
    }

    const iniciarEdicion = (v: VariableDef) => {
        if (!v.field) return   // derivadas de hablantes, no editables aquí
        setEditando(v.key)
        setValorEdit(getValor(v))
    }

    const guardarEdicion = async (v: VariableDef) => {
        if (!v.field) return
        setEditando(null)
        try {
            const { data } = await api.put(`/api/audiencias/${audiencia.id}`, {
                [v.field]: valorEdit || null,
            })
            onAudienciaActualizada(data)
        } catch (err) {
            console.error('Error actualizando variable:', err)
        }
    }

    // Agrupar variables
    const grupos = ['expediente', 'personas', 'datos', 'tiempo'] as const

    return (
        <div className="p-4 space-y-5">
            <h3
                className="text-[10px] font-bold uppercase tracking-widest flex items-center justify-between"
                style={{ color: 'var(--text-muted)' }}
            >
                Variables de Plantilla
                <span
                    className="text-[8px] px-1.5 py-0.5 font-mono"
                    style={{ background: 'var(--brand-gold-muted)', color: 'var(--accent-gold)', border: '1px solid var(--brand-gold)/20' }}
                >
                    {'{{'}'{'}}'}
                </span>
            </h3>

            {/* Detecciones automáticas pendientes */}
            {detecciones.length > 0 && (
                <div className="space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-gold)' }}>
                        Detectado en transcripción
                    </p>
                    {detecciones.map(det => (
                        <div
                            key={det.key}
                            className="p-3 rounded-[2px] border"
                            style={{ background: 'rgba(196,150,64,0.06)', borderColor: 'rgba(196,150,64,0.3)' }}
                        >
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div>
                                    <span className="text-[9px] font-mono font-bold" style={{ color: 'var(--accent-gold)' }}>
                                        {toToken(det.key)}
                                    </span>
                                    <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                                        {det.valorDetectado}
                                    </p>
                                    <p className="text-[9px] italic mt-0.5 truncate max-w-[160px]" style={{ color: 'var(--text-muted)' }}>
                                        "…{det.texto}…"
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => onAceptarDeteccion(det)}
                                    className="flex-1 py-1 text-[9px] font-bold uppercase tracking-wider"
                                    style={{ background: 'rgba(5,150,105,0.15)', color: '#059669', border: '1px solid rgba(5,150,105,0.3)' }}
                                >
                                    Aceptar
                                </button>
                                <button
                                    onClick={() => onRechazarDeteccion(det.key)}
                                    className="flex-1 py-1 text-[9px] font-bold uppercase tracking-wider"
                                    style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                                >
                                    Ignorar
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Variables por grupo */}
            {grupos.map(grupo => {
                const vars = VARIABLES_DEF.filter(v => v.grupo === grupo)
                return (
                    <div key={grupo}>
                        <p className="text-[9px] font-bold uppercase tracking-widest mb-2 opacity-50">
                            {GRUPO_LABELS[grupo]}
                        </p>
                        <div className="space-y-1.5">
                            {vars.map(v => {
                                const valor = getValor(v)
                                const lleno = !!valor
                                const isEditando = editando === v.key
                                const editable = !!v.field

                                return (
                                    <div
                                        key={v.key}
                                        className="group rounded-[2px] overflow-hidden"
                                        style={{
                                            border: `1px solid ${lleno ? 'var(--border-subtle)' : 'rgba(220,38,38,0.15)'}`,
                                            background: lleno ? 'var(--bg-surface)' : 'rgba(220,38,38,0.03)',
                                        }}
                                    >
                                        <div className="flex items-center gap-2 px-2 py-1.5">
                                            {/* Indicador */}
                                            <span
                                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                                style={{ background: lleno ? '#059669' : '#DC2626' }}
                                            />
                                            {/* Etiqueta */}
                                            <div className="flex-1 min-w-0">
                                                <span className="text-[9px] font-mono opacity-50 block truncate">
                                                    {toToken(v.key)}
                                                </span>
                                                {isEditando ? (
                                                    <input
                                                        autoFocus
                                                        value={valorEdit}
                                                        onChange={e => setValorEdit(e.target.value)}
                                                        onBlur={() => guardarEdicion(v)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') guardarEdicion(v)
                                                            if (e.key === 'Escape') setEditando(null)
                                                        }}
                                                        className="w-full text-[11px] font-medium bg-transparent outline-none border-b"
                                                        style={{
                                                            color: 'var(--text-primary)',
                                                            borderColor: 'var(--accent-gold)',
                                                        }}
                                                    />
                                                ) : (
                                                    <span
                                                        className="text-[11px] font-medium truncate block"
                                                        style={{ color: lleno ? 'var(--text-primary)' : 'var(--text-muted)' }}
                                                    >
                                                        {valor || (editable ? 'Sin definir' : 'Del panel Hablantes')}
                                                    </span>
                                                )}
                                            </div>
                                            {/* Acciones */}
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                {/* Copiar token */}
                                                <button
                                                    onClick={() => copiarToken(v.key)}
                                                    title={`Copiar ${toToken(v.key)}`}
                                                    className="p-1 rounded"
                                                    style={{ color: copiado === v.key ? '#059669' : 'var(--text-muted)' }}
                                                >
                                                    {copiado === v.key ? (
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                                                    ) : (
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                                    )}
                                                </button>
                                                {/* Editar (solo campos directos) */}
                                                {editable && (
                                                    <button
                                                        onClick={() => iniciarEdicion(v)}
                                                        title="Editar valor"
                                                        className="p-1 rounded"
                                                        style={{ color: 'var(--text-muted)' }}
                                                    >
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            })}

            <p className="text-[9px] opacity-40 leading-relaxed pt-1">
                Haz clic en <svg className="inline w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> para copiar el token y pegarlo en el acta. Los valores en rojo aún no están definidos.
            </p>
        </div>
    )
}
