'use client'

/**
 * Panel flotante con las sugerencias del diccionario jurídico (LegalDictionary)
 * que el backend emite vía WebSocket durante la transcripción en vivo.
 *
 * Aparece en la esquina inferior derecha cuando hay sugerencias pendientes.
 * Click en una sugerencia → la descarta (al menos para esta sesión).
 * Para aplicar la corrección al texto, el usuario aún debe hacerlo manualmente
 * en el canvas (la sustitución automática requeriría modificar el segmento
 * por ID, lo cual es más invasivo y se hace en una iteración posterior).
 */
import { useState } from 'react'
import { BookOpen, X, ChevronUp, ChevronDown } from 'lucide-react'
import type { SuggestionMessage } from '@/types'

interface Props {
    sugerencias: SuggestionMessage[]
    onDescartar: (index: number) => void
    onDescartarTodas: () => void
}

export default function SugerenciasDiccionarioFlotante({ sugerencias, onDescartar, onDescartarTodas }: Props) {
    const [expandido, setExpandido] = useState(false)

    if (sugerencias.length === 0) return null

    return (
        <div className="fixed bottom-6 right-6 z-30 w-80 bg-white rounded-2xl shadow-2xl border border-[#A68246]/20 overflow-hidden">
            <button
                onClick={() => setExpandido(v => !v)}
                className="w-full px-4 py-3 bg-[#1B3A5C] text-white flex items-center justify-between hover:brightness-110 transition-all"
            >
                <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-[#A68246]" />
                    <span className="text-[11px] font-bold uppercase tracking-widest">
                        {sugerencias.length} Sugerencia{sugerencias.length !== 1 ? 's' : ''} jurídica{sugerencias.length !== 1 ? 's' : ''}
                    </span>
                </div>
                {expandido ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            {expandido && (
                <>
                    <ul className="max-h-72 overflow-y-auto divide-y divide-[#1B3A5C]/5">
                        {sugerencias.map((s, idx) => (
                            <li key={`${s.segment_order}-${s.position.start}-${idx}`} className="px-4 py-2.5 flex items-center gap-2 hover:bg-[#FDFCFB]">
                                <div className="flex-1 min-w-0 text-xs">
                                    <div className="font-mono">
                                        <span className="text-red-600 line-through">{s.original_word}</span>
                                        <span className="mx-1 text-[#1B3A5C]/30">→</span>
                                        <span className="text-emerald-700 font-bold">{s.suggested_word}</span>
                                    </div>
                                    <p className="text-[10px] text-[#1B3A5C]/50 mt-0.5 uppercase tracking-wider">{s.category}</p>
                                </div>
                                <button
                                    onClick={() => onDescartar(idx)}
                                    className="shrink-0 p-1.5 text-[#1B3A5C]/30 hover:text-red-500 transition-colors"
                                    title="Descartar"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button
                        onClick={onDescartarTodas}
                        className="w-full px-4 py-2 bg-[#FDFCFB] text-[#1B3A5C]/60 text-[10px] font-bold uppercase tracking-widest hover:bg-[#1B3A5C]/5 transition-all border-t border-[#1B3A5C]/5"
                    >
                        Descartar todas
                    </button>
                </>
            )}
        </div>
    )
}
