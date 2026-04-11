'use client'

/**
 * WordCorrectionPopover — Popover para corregir palabras usando IA.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { analyzeWordInContext, type WordAnalysisResult } from '@/lib/contextAnalysis'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, Sparkles, Loader2, MessageSquare } from 'lucide-react'

export interface WordAlternative {
    word: string
    confidence: number
}

interface WordCorrectionPopoverProps {
    originalWord: string
    confidence: number
    alternatives?: WordAlternative[]
    sentenceContext?: string
    segmentType?: 'pregunta' | 'afirmación' | 'respuesta' | 'declaración'
    position: { x: number; y: number }
    onSelect: (newWord: string) => void
    onAccept: () => void
    onClose: () => void
    isOpen: boolean
}

export default function WordCorrectionPopover({
    originalWord,
    confidence,
    alternatives = [],
    sentenceContext = '',
    segmentType,
    position,
    onSelect,
    onAccept,
    onClose,
    isOpen,
}: WordCorrectionPopoverProps) {
    const [customWord, setCustomWord] = useState('')
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [aiResult, setAiResult] = useState<WordAnalysisResult | null>(null)
    const popoverRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (isOpen && sentenceContext && originalWord) {
            setIsAnalyzing(true)
            setAiResult(null)
            analyzeWordInContext(originalWord, sentenceContext, confidence)
                .then(result => {
                    setAiResult(result)
                    setIsAnalyzing(false)
                })
                .catch(() => setIsAnalyzing(false))
        }
    }, [isOpen, originalWord, sentenceContext, confidence])

    const allSuggestions = useMemo(() => {
        const combined: Array<{ word: string; confidence: number; reason?: string }> = []
        if (aiResult?.suggestions) {
            aiResult.suggestions.forEach(s => {
                if (!combined.find(c => c.word.toLowerCase() === s.word.toLowerCase())) {
                    combined.push({ word: s.word, confidence: s.confidence, reason: s.reason })
                }
            })
        }
        alternatives.forEach(alt => {
            if (!combined.find(c => c.word.toLowerCase() === alt.word.toLowerCase())) {
                combined.push({ word: alt.word, confidence: alt.confidence })
            }
        })
        return combined.slice(0, 5)
    }, [aiResult, alternatives])

    const detectedType = aiResult?.segment_type || segmentType || 'afirmación'
    const correctedSentence = aiResult?.corrected_sentence || sentenceContext

    useEffect(() => {
        if (!isOpen) {
            setCustomWord('')
            setSelectedIndex(null)
            setAiResult(null)
        }
    }, [isOpen])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose()
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen, onClose])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return
            if (e.key === 'Escape') onClose()
            else if (e.key === 'Enter') {
                if (selectedIndex !== null && allSuggestions[selectedIndex]) onSelect(allSuggestions[selectedIndex].word)
            } else if (e.key >= '1' && e.key <= '5') {
                const index = parseInt(e.key) - 1
                if (index < allSuggestions.length) onSelect(allSuggestions[index].word)
            }
        }
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown)
            return () => document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen, selectedIndex, allSuggestions, onSelect, onClose])

    if (!isOpen) return null

    const confidencePercent = Math.round(confidence * 100)
    const confidenceColor = confidence >= 0.85 ? '#16a34a' : confidence >= 0.7 ? '#ca8a04' : '#dc2626'

    return (
        <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="fixed z-[100] bg-white rounded-[24px] shadow-2xl border border-[#1B3A5C]/10 w-[420px] overflow-hidden"
            style={{
                left: `${Math.min(position.x, typeof window !== 'undefined' ? window.innerWidth - 440 : 0)}px`,
                top: `${Math.min(position.y + 10, typeof window !== 'undefined' ? window.innerHeight - 500 : 0)}px`,
            }}
        >
            {/* Header */}
            <div className="px-6 py-4 bg-[#1B3A5C]/[0.02] border-b border-[#1B3A5C]/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#1B3A5C]/5 text-[#1B3A5C] rounded-xl flex items-center justify-center">
                        <MessageSquare className="w-4 h-4" />
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-[#1B3A5C] uppercase tracking-wider">Análisis Judicial</h3>
                        <p className="text-[9px] font-bold text-[#1B3A5C]/40 uppercase tracking-widest">{detectedType}</p>
                    </div>
                </div>
                <button onClick={onClose} className="p-2 text-[#1B3A5C]/20 hover:text-[#1B3A5C] transition-colors"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-6 space-y-6">
                {/* Contexto */}
                <div className="space-y-2">
                    <span className="text-[9px] font-bold text-[#1B3A5C]/30 uppercase tracking-widest">Frase Original</span>
                    <p className="text-xs leading-relaxed text-[#1B3A5C] p-3 bg-[#F7F5F2] rounded-xl border-l-4" style={{ borderColor: confidenceColor }}>
                        {sentenceContext}
                    </p>
                </div>

                {/* Palabra y Confianza */}
                <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-[#1B3A5C]/5 shadow-sm">
                    <div className="flex flex-col">
                        <span className="text-[8px] font-bold text-[#1B3A5C]/30 uppercase">Palabra Detectada</span>
                        <span className="text-lg font-bold text-[#1B3A5C] tracking-tight">"{originalWord}"</span>
                    </div>
                    <div className="text-right">
                        <span className="text-[8px] font-bold text-[#1B3A5C]/30 uppercase block">Confianza</span>
                        <span className="text-sm font-mono font-bold" style={{ color: confidenceColor }}>{confidencePercent}%</span>
                    </div>
                </div>

                {/* Sugerencias IA */}
                <div className="space-y-3">
                    <span className="text-[9px] font-bold text-[#A68246] uppercase tracking-widest flex items-center gap-2">
                        <Sparkles className="w-3 h-3" /> Sugerencias de Precisión
                    </span>
                    <div className="space-y-2">
                        {isAnalyzing ? (
                            <div className="flex items-center gap-3 p-4 bg-[#FDFCFB] rounded-xl border border-dashed border-[#1B3A5C]/10">
                                <Loader2 className="w-4 h-4 animate-spin text-[#A68246]" />
                                <span className="text-[10px] font-bold text-[#1B3A5C]/40 uppercase">Consultando Claude AI...</span>
                            </div>
                        ) : (
                            allSuggestions.map((sug, i) => (
                                <button
                                    key={i}
                                    onClick={() => onSelect(sug.word)}
                                    className="w-full flex items-center justify-between p-3 bg-white hover:bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/5 transition-all text-left group"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="w-5 h-5 flex items-center justify-center rounded-lg bg-[#1B3A5C]/5 text-[#1B3A5C]/40 text-[10px] font-bold group-hover:bg-[#1B3A5C] group-hover:text-white transition-all">{i + 1}</span>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-[#1B3A5C]">{sug.word}</span>
                                            {sug.reason && <span className="text-[9px] text-[#1B3A5C]/40">{sug.reason}</span>}
                                        </div>
                                    </div>
                                    <span className="text-[9px] font-mono text-[#1B3A5C]/20">{Math.round(sug.confidence * 100)}%</span>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Input Manual */}
                <div className="space-y-2 pt-2 border-t border-[#1B3A5C]/5">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={customWord}
                            onChange={(e) => setCustomWord(e.target.value)}
                            placeholder="Corrección manual..."
                            className="flex-1 px-4 py-3 bg-[#1B3A5C]/[0.03] border-none rounded-xl text-xs font-medium text-[#1B3A5C] outline-none focus:ring-2 focus:ring-[#A68246]/20 transition-all"
                        />
                        <button
                            onClick={() => customWord.trim() && onSelect(customWord.trim())}
                            disabled={!customWord.trim()}
                            className="px-6 py-3 bg-[#1B3A5C] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:brightness-110 disabled:opacity-30 transition-all shadow-lg shadow-[#1B3A5C]/20"
                        >
                            Aplicar
                        </button>
                    </div>
                </div>

                <button
                    onClick={onAccept}
                    className="w-full py-3.5 bg-white border-2 border-[#16a34a]/30 text-[#16a34a] rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-[#16a34a] hover:text-white hover:border-[#16a34a] transition-all flex items-center justify-center gap-2"
                >
                    <Check className="w-4 h-4" /> Validar Palabra Original
                </button>
            </div>
        </motion.div>
    )
}
