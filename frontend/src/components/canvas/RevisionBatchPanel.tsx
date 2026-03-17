'use client'

import { useState, useMemo } from 'react'
import { Segmento } from '@/types'
import { Check, X, AlertTriangle } from 'lucide-react'

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

    if (propuestas.length === 0) {
        return null
    }

    const aceptarTodas = async () => {
        setIsApplying(true)
        const decisiones = propuestas.map(p => ({ segment_id: p.id, accion: 'aceptar' }))
        await onAplicarBatch(decisiones)
        setIsApplying(false)
    }

    return (
        <div className="absolute top-4 right-4 w-96 max-h-[80vh] flex flex-col bg-white rounded-xl shadow-2xl border border-[var(--border-subtle)] overflow-hidden z-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-[var(--accent-gold)]" />
                    <h3 className="font-semibold text-sm text-[var(--text-primary)]">
                        Propuestas Batch ({propuestas.length})
                    </h3>
                </div>
                <button
                    onClick={aceptarTodas}
                    disabled={isApplying}
                    className="px-3 py-1.5 bg-[var(--accent-gold)] text-white text-xs font-medium rounded-md hover:brightness-110 disabled:opacity-50 transition-all"
                >
                    {isApplying ? 'Aplicando...' : 'Aceptar Todas'}
                </button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
                {propuestas.map(prop => (
                    <div key={prop.id} className="bg-white p-3 rounded-lg border border-[var(--border-subtle)] shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-[10px] font-mono text-[var(--text-muted)]">
                                {new Date(prop.timestamp_inicio * 1000).toISOString().substr(14, 5)}
                            </span>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => onAceptar(prop.id, 'aceptar')}
                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    title="Aceptar propuesta"
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => onAceptar(prop.id, 'rechazar')}
                                    className="p-1 text-red-500 hover:bg-red-50 rounded"
                                    title="Rechazar y mantener original"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Comparación visual */}
                        <div className="space-y-2 text-xs">
                            <div>
                                <span className="block text-[10px] font-semibold text-red-500 uppercase mb-0.5">Texto Actual (Streaming)</span>
                                <p className="line-through text-[var(--text-secondary)] bg-red-50/50 p-1.5 rounded">
                                    {prop.texto_mejorado || prop.texto_ia}
                                </p>
                            </div>
                            <div>
                                <span className="block text-[10px] font-semibold text-green-600 uppercase mb-0.5">Propuesta Batch (Alta Precisión)</span>
                                <p className="text-[var(--text-primary)] bg-green-50/50 p-1.5 rounded font-medium">
                                    {prop.texto_batch}
                                </p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
