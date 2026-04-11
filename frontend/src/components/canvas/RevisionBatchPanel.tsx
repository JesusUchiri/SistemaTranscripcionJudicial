'use client'

import { useState, useMemo } from 'react'
import { Segmento } from '@/types'
import { Check, X, Sparkles, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface RevisionBatchPanelProps {
    segmentos: Segmento[]
    onAceptar: (id: string, accion: 'aceptar' | 'rechazar') => void
    onAplicarBatch: (decisiones: Array<{ segment_id: string, accion: string }>) => Promise<void>
}

export default function RevisionBatchPanel({ segmentos, onAceptar, onAplicarBatch }: RevisionBatchPanelProps) {
    const propuestas = useMemo(() => {
        return segmentos.filter(s => s.texto_batch != null && !s.editado_por_usuario)
    }, [segmentos])

    const [isApplying, setIsApplying] = useState(false)

    if (propuestas.length === 0) return null

    const aceptarTodas = async () => {
        setIsApplying(true)
        const decisiones = propuestas.map(p => ({ segment_id: p.id, accion: 'aceptar' }))
        await onAplicarBatch(decisiones)
        setIsApplying(false)
    }

    return (
        <div className="absolute top-6 right-8 w-[400px] max-h-[70vh] flex flex-col bg-white rounded-[32px] shadow-2xl border border-[#1B3A5C]/10 overflow-hidden z-50 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-[#1B3A5C]/[0.02] border-b border-[#1B3A5C]/5">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#A68246]/10 text-[#A68246] rounded-xl flex items-center justify-center">
                        <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-[#1B3A5C] uppercase tracking-wider">Mejoras de Precisión</h3>
                        <p className="text-[9px] font-bold text-[#1B3A5C]/40 uppercase tracking-widest">{propuestas.length} pendientes</p>
                    </div>
                </div>
                <button
                    onClick={aceptarTodas}
                    disabled={isApplying}
                    className="px-4 py-2 bg-[#1B3A5C] text-white text-[10px] font-bold uppercase tracking-widest rounded-xl hover:brightness-110 disabled:opacity-50 transition-all shadow-lg shadow-[#1B3A5C]/10"
                >
                    {isApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Aceptar Todas'}
                </button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 bg-[#FDFCFB]">
                <AnimatePresence>
                    {propuestas.map(prop => (
                        <motion.div 
                            key={prop.id} 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="bg-white p-4 rounded-2xl border border-[#1B3A5C]/5 shadow-sm hover:shadow-md transition-all group"
                        >
                            <div className="flex justify-between items-start mb-3">
                                <span className="text-[10px] font-mono font-bold text-[#1B3A5C]/30">
                                    TS: {new Date(prop.timestamp_inicio * 1000).toISOString().substr(14, 5)}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => onAceptar(prop.id, 'rechazar')}
                                        className="w-7 h-7 flex items-center justify-center text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-all"
                                        title="Mantener original"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => onAceptar(prop.id, 'aceptar')}
                                        className="w-7 h-7 flex items-center justify-center text-green-500 hover:bg-green-50 hover:text-green-700 rounded-lg transition-all"
                                        title="Aplicar mejora"
                                    >
                                        <Check className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="p-2.5 bg-red-50/30 rounded-xl border border-red-100/50">
                                    <span className="block text-[8px] font-bold text-red-400 uppercase tracking-widest mb-1">Streaming</span>
                                    <p className="text-[11px] leading-relaxed text-red-800/60 line-through italic">
                                        {prop.texto_mejorado || prop.texto_ia}
                                    </p>
                                </div>
                                <div className="p-2.5 bg-green-50/30 rounded-xl border border-green-100/50">
                                    <span className="block text-[8px] font-bold text-green-600 uppercase tracking-widest mb-1">Mejora Batch</span>
                                    <p className="text-[11px] leading-relaxed text-[#1B3A5C] font-medium">
                                        {prop.texto_batch}
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    )
}
