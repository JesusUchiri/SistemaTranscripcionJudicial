'use client'

/**
 * PanelHablantes — Vista refinada de los intervinientes.
 * Recibe los datos del padre para asegurar sincronización global.
 */
import { useState } from 'react'
import api from '@/lib/api'
import { SPEAKER_ROLES } from '@/types'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Sparkles, Loader2, Mic2 } from 'lucide-react'

interface Hablante {
    id: string
    speaker_id: string
    rol: string
    etiqueta: string
    nombre: string | null
    color: string
    orden: number
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
    hablantes: Hablante[]
    onHablanteActualizado: (hablante: Hablante) => void
    hablandoAhora?: string | null
    onInferirRoles: () => Promise<void>
    infiriendoRoles: boolean
    inferencias: InferenciaSugerencia[] | null
    onAceptarInferencia: (sug: InferenciaSugerencia) => void
    onDescartarInferencia: (speakerId: string) => void
}

export default function PanelHablantes({
    audienciaId,
    hablantes,
    onHablanteActualizado,
    hablandoAhora = null,
    onInferirRoles,
    infiriendoRoles,
    inferencias,
    onAceptarInferencia,
    onDescartarInferencia
}: PanelHablantesProps) {
    const [editando, setEditando] = useState<string | null>(null)
    const [cargando, setCargando] = useState(false)

    const actualizarRol = async (hablanteId: string, nuevoRol: string) => {
        setCargando(true)
        try {
            const { data } = await api.put(`/api/audiencias/${audienciaId}/hablantes/${hablanteId}`, { rol: nuevoRol })
            onHablanteActualizado(data)
            setEditando(null)
        } catch (err) { console.error(err) } finally { setCargando(false) }
    }

    const actualizarNombre = async (hablanteId: string, nombre: string) => {
        try {
            const { data } = await api.put(`/api/audiencias/${audienciaId}/hablantes/${hablanteId}`, { nombre })
            onHablanteActualizado(data)
        } catch (err) { console.error(err) }
    }

    return (
        <div className="p-4 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#1B3A5C]/40" />
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1B3A5C]/60">Intervinientes</h3>
                </div>
                {hablantes.length > 0 && (
                    <button
                        onClick={onInferirRoles}
                        disabled={infiriendoRoles}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#A68246]/10 text-[#A68246] text-[9px] font-bold uppercase tracking-widest hover:bg-[#A68246]/20 transition-all disabled:opacity-50"
                    >
                        {infiriendoRoles ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        Inferir Roles
                    </button>
                )}
            </div>

            {/* Inferencia UI */}
            <AnimatePresence>
                {inferencias && inferencias.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="p-4 bg-[#A68246]/5 rounded-2xl border border-[#A68246]/20 space-y-3">
                        <p className="text-[9px] font-bold text-[#A68246] uppercase tracking-widest">Sugerencias de IA</p>
                        {inferencias.map(sug => (
                            <div key={sug.speaker_id} className="bg-white p-3 rounded-xl shadow-sm border border-[#A68246]/10 flex items-start gap-3">
                                <div className="w-1 self-stretch rounded-full" style={{ background: sug.color_sugerido }} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] font-bold text-[#1B3A5C]">{sug.speaker_id}</span>
                                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#1B3A5C]/5 text-[#1B3A5C]">{sug.rol_sugerido}</span>
                                    </div>
                                    <p className="text-[9px] text-[#1B3A5C]/50 leading-tight mb-2">{sug.razon}</p>
                                    <div className="flex gap-1">
                                        <button onClick={() => onAceptarInferencia(sug)} className="flex-1 py-1.5 bg-green-50 text-green-600 text-[8px] font-bold uppercase rounded-lg hover:bg-green-100 transition-all text-center">Aceptar</button>
                                        <button onClick={() => onDescartarInferencia(sug.speaker_id)} className="flex-1 py-1.5 bg-red-50 text-red-400 text-[8px] font-bold uppercase rounded-lg hover:bg-red-100 transition-all text-center">Descartar</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="space-y-3">
                {hablantes.length === 0 ? (
                    <div className="p-8 text-center border border-dashed border-[#1B3A5C]/10 rounded-2xl">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A5C]/30 animate-pulse">Esperando audio...</p>
                    </div>
                ) : (
                    hablantes.map((h) => (
                        <div
                            key={h.id}
                            className={`p-4 rounded-2xl border transition-all relative overflow-hidden group ${
                                editando === h.id ? 'bg-white border-[#A68246] shadow-lg' : 'bg-white border-[#1B3A5C]/5 shadow-sm'
                            }`}
                        >
                            <div className="absolute top-0 left-0 w-1 h-full" style={{ background: h.color }} />
                            
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-md" style={{ background: h.color }}>
                                        {h.etiqueta.charAt(0)}
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-bold text-[#1B3A5C]">{h.speaker_id}</div>
                                        {hablandoAhora === h.speaker_id && (
                                            <div className="flex items-center gap-1">
                                                <Mic2 className="w-2.5 h-2.5 text-pink-500 animate-pulse" />
                                                <span className="text-[8px] font-bold text-pink-500 uppercase tracking-widest">En vivo</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <label className="text-[8px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest ml-1">Rol</label>
                                    <select
                                        value={h.rol}
                                        onChange={(e) => actualizarRol(h.id, e.target.value)}
                                        onFocus={() => setEditando(h.id)}
                                        onBlur={() => setEditando(null)}
                                        className="w-full px-3 py-2 bg-[#1B3A5C]/[0.03] border-none rounded-xl text-[10px] font-bold uppercase tracking-wider text-[#1B3A5C] focus:ring-2 focus:ring-[#A68246]/20 outline-none transition-all"
                                    >
                                        {SPEAKER_ROLES.map((rol) => (
                                            <option key={rol.id} value={rol.key}>{rol.rol.toUpperCase()}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[8px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest ml-1">Identidad</label>
                                    <input
                                        type="text"
                                        value={h.nombre || ''}
                                        onChange={(e) => actualizarNombre(h.id, e.target.value)}
                                        placeholder="Nombre completo..."
                                        className="w-full px-3 py-2 bg-[#1B3A5C]/[0.03] border-none rounded-xl text-[10px] font-medium text-[#1B3A5C] placeholder:text-[#1B3A5C]/20 focus:ring-2 focus:ring-[#A68246]/20 outline-none transition-all"
                                    />
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
