'use client'

/**
 * TranscriptionCanvas — Editor TipTap para transcripción en tiempo real.
 * 
 * Refinado con estética "Tinta y Oro" para presentación formal.
 */
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useMemo, useState } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { SpeakerNode, SegmentMark, LowConfidenceMark, BookmarkNode, ProvisionalNode } from '@/extensions'
import WordCorrectionPopover from './WordCorrectionPopover'
import type { Segmento } from '@/types'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, UserCircle2, MessageSquare, ListFilter, Users, Scale, Activity } from 'lucide-react'

/* ── Estilos Inyectados para el Canvas ──────────────── */
const canvasStyles = `
  .ProseMirror {
    font-variant-numeric: tabular-nums;
    line-height: 1.8;
    padding: 60px 80px !important;
    color: #1A1A1A;
  }

  /* Etiquetas de Hablantes */
  speaker-label {
    display: inline-flex;
    align-items: center;
    margin-top: 24px;
    margin-bottom: 8px;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    user-select: none;
    cursor: pointer;
    padding: 4px 12px;
    border-radius: 8px;
    background: var(--bg-ink-soft);
    border: 1px solid var(--border-subtle);
    transition: all 0.2s ease;
  }

  speaker-label:hover {
    background: var(--brand-ink);
    color: white !important;
    border-color: var(--brand-ink);
    transform: scale(1.02);
  }

  /* Marcas de Segmento */
  .segment-mark {
    cursor: pointer;
    transition: all 0.3s ease;
    border-radius: 4px;
    padding: 2px 0;
  }

  .segment-mark:hover {
    background: var(--brand-gold-muted);
  }

  .segment-active {
    background: rgba(166, 130, 70, 0.15) !important;
    box-shadow: 0 0 0 2px rgba(166, 130, 70, 0.1);
  }

  /* Correcciones de Claude */
  .word-corrected-by-claude {
    color: var(--brand-ink);
    font-weight: 600;
    border-bottom: 1.5px solid var(--brand-gold);
    background: rgba(166, 130, 70, 0.05);
  }

  /* Palabras de Baja Confianza */
  .text-low-confidence {
    border-bottom: 1.5px dashed #EF4444;
    cursor: help;
  }

  /* Texto Provisional (Streaming) */
  .provisional-text {
    color: var(--text-muted);
    font-style: italic;
    animation: fadeIn 0.5s ease forwards;
  }

  @keyframes fadeIn {
    from { opacity: 0.5; }
    to { opacity: 1; }
  }
`;

/* ── Palabras gramaticales ── */
const GRAMMAR_WORDS = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'a', 'de', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre',
    'y', 'e', 'o', 'u', 'que', 'si', 'pero', 'sino', 'porque',
    'yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'me', 'te', 'se'
])

const KNOWN_LEGAL_TERMS = new Set([
    'audiencia', 'expediente', 'juzgado', 'sala', 'cusco', 'justicia', 'delito'
])

/* ── Types ──────────────────────────────────────────── */

export interface TranscriptionCanvasHandle {
    insertContent: (text: string) => void
    getEditor: () => ReturnType<typeof useEditor>
    scrollToEnd: () => void
    scrollToSegment: (segmentId: string) => void
    undo: () => void
    redo: () => void
}

interface HablanteInfo {
    speaker_id: string
    etiqueta: string
    color: string
    nombre?: string | null
}

interface PopoverState {
    isOpen: boolean
    word: string
    confidence: number
    pos: { from: number; to: number }
    screenPos: { x: number; y: number }
    segmentId: string
    sentenceContext: string
    alternatives: Array<{ word: string; confidence: number }>
}

interface SpeakerPopoverState {
    isOpen: boolean
    firstSegmentId: string
    currentSpeakerId: string
    screenPos: { x: number; y: number }
}

interface CanvasProps {
    soloLectura: boolean
    hablantes?: HablanteInfo[]
    onSegmentoEditado?: (segmentoId: string, textoNuevo: string) => void
    onSeekAudio?: (timestamp: number) => void
    currentAudioTime?: number
    onSpeakerCambiado?: (firstSegmentId: string, newSpeakerId: string) => void
    onReasignarSegmentos?: (segmentIds: string[], newSpeakerId: string) => void
}

/* ── Render Helpers ─────────────────────────────────── */

function computeChangedWordIndices(original: string, enhanced: string): Set<number> {
    const normalize = (w: string) => w.toLowerCase().replace(/[.,;:!?¡¿«»\-'"]/g, '').trim()
    const origWords = original.trim().split(/\s+/).map(normalize)
    const enhWords = enhanced.trim().split(/\s+/)
    const changed = new Set<number>()
    enhWords.forEach((w, i) => {
        if (normalize(w) !== (origWords[i] ?? '')) changed.add(i)
    })
    return changed
}

function renderSegmentWords(texto: string, palabrasJson: any[] | null, segId: string, changedIndices?: Set<number>): string {
    if (!texto) return ''
    const confMap = new Map<string, number>()
    if (palabrasJson) {
        for (const w of palabrasJson) {
            const key = (w.word || '').toLowerCase().replace(/[.,;:!?¡¿«»\-]/g, '')
            if (key && (confMap.get(key) === undefined || w.confidence < confMap.get(key)!)) confMap.set(key, w.confidence)
        }
    }
    const words = texto.trim().split(/\s+/)
    return words.map((wordText, idx) => {
        const key = wordText.toLowerCase().replace(/[.,;:!?¡¿«»\-]/g, '')
        const conf = confMap.size > 0 ? (confMap.get(key) ?? 1.0) : 1.0
        const shouldMark = conf < 0.85 && !GRAMMAR_WORDS.has(key) && !KNOWN_LEGAL_TERMS.has(key) && key.length > 2
        const isChanged = changedIndices?.has(idx) ?? false
        if (shouldMark) {
            return `<span class="text-low-confidence${isChanged ? ' word-corrected-by-claude' : ''}" data-low-confidence="true" data-confidence="${conf}" data-segment-id="${segId}">${wordText}</span>`
        }
        if (isChanged) return `<span class="word-corrected-by-claude">${wordText}</span>`
        return wordText
    }).join(' ') + ' '
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
    let timer: any = null
    const debounced = (...args: any[]) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => fn(...args), ms)
    }
    debounced.cancel = () => clearTimeout(timer)
    return debounced as any
}

/* ── Main Component ─────────────────────────────────── */

const TranscriptionCanvas = forwardRef<TranscriptionCanvasHandle, CanvasProps>(({
    soloLectura,
    hablantes = [],
    onSegmentoEditado,
    onSeekAudio,
    currentAudioTime = 0,
    onSpeakerCambiado,
    onReasignarSegmentos,
}, ref) => {
    const {
        segments,
        provisionalText,
        provisionalSpeaker,
        activeSegmentId,
        updateSegment,
    } = useCanvasStore()

    const [popover, setPopover] = useState<PopoverState>({
        isOpen: false, word: '', confidence: 0, pos: { from: 0, to: 0 }, screenPos: { x: 0, y: 0 },
        segmentId: '', sentenceContext: '', alternatives: []
    })

    const [speakerPopover, setSpeakerPopover] = useState<SpeakerPopoverState>({
        isOpen: false, firstSegmentId: '', currentSpeakerId: '', screenPos: { x: 0, y: 0 }
    })

    const [selectionToolbar, setSelectionToolbar] = useState<{ isActive: boolean, segmentIds: string[], pos: { x: number, y: number }, anchor: 'above' | 'below' }>({
        isActive: false, segmentIds: [], pos: { x: 0, y: 0 }, anchor: 'below'
    })

    const prevSegmentCountRef = useRef(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const lastConfirmedSpeakerRef = useRef<string | null>(null)

    const speakerMap = useMemo(() => {
        const map = new Map<string, HablanteInfo>()
        hablantes.forEach(h => map.set(h.speaker_id, h))
        return map
    }, [hablantes])

    const getSpeakerInfo = useCallback((speakerId: string) => {
        const info = speakerMap.get(speakerId)
        const label = info ? (info.nombre ? `${info.etiqueta} ${info.nombre}` : info.etiqueta) : `${speakerId.toUpperCase()}:`
        const color = info ? info.color : '#1B3A5C'
        return { etiqueta: label, color }
    }, [speakerMap])

    const debouncedSave = useMemo(() => debounce((segId: string, text: string) => onSegmentoEditado?.(segId, text), 800), [onSegmentoEditado])

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ heading: false }),
            Placeholder.configure({ placeholder: soloLectura ? 'Iniciando transcripción...' : 'Comience a escribir o grabar...' }),
            SpeakerNode, SegmentMark, LowConfidenceMark, BookmarkNode, ProvisionalNode
        ],
        editable: !soloLectura,
        content: '',
        editorProps: {
            attributes: { class: 'focus:outline-none min-h-[600px] w-full' },
            handleClick: (view, pos, event) => {
                const target = event.target as HTMLElement
                const speakerLabelEl = target.closest('speaker-label') as HTMLElement
                if (speakerLabelEl && onSpeakerCambiado) {
                    setSpeakerPopover({
                        isOpen: true,
                        firstSegmentId: speakerLabelEl.getAttribute('data-first-segment-id') || '',
                        currentSpeakerId: speakerLabelEl.getAttribute('data-speaker-id') || '',
                        screenPos: { x: event.clientX, y: event.clientY }
                    })
                    return true
                }
                const lowConfEl = target.closest('[data-low-confidence="true"]') as HTMLElement
                if (lowConfEl) {
                    const word = lowConfEl.innerText.trim()
                    const confidence = parseFloat(lowConfEl.getAttribute('data-confidence') || '0')
                    const segmentEl = target.closest('[data-segment-id]') as HTMLElement
                    const segmentId = segmentEl?.getAttribute('data-segment-id') || ''
                    const segmentData = segments.find(s => s.id === segmentId)
                    const wordData = segmentData?.palabras_json?.find((w: any) => w.word.toLowerCase() === word.toLowerCase())
                    const nodePos = view.posAtDOM(lowConfEl, 0)
                    setPopover({
                        isOpen: true, word, confidence, pos: { from: nodePos, to: nodePos + word.length },
                        screenPos: { x: event.clientX, y: event.clientY }, segmentId,
                        sentenceContext: segmentEl?.textContent?.trim() || '',
                        alternatives: wordData?.alternatives?.map((alt: any) => ({ word: alt.word || alt, confidence: alt.confidence || 0.8 })) || []
                    })
                    return true
                }
                const segmentEl = target.closest('[data-segment-id]') as HTMLElement
                if (segmentEl && onSeekAudio) {
                    onSeekAudio(parseFloat(segmentEl.getAttribute('data-timestamp') || '0'))
                    return true
                }
                return false
            }
        },
        onUpdate: ({ editor: ed, transaction }) => {
            if (soloLectura || !transaction.docChanged) return
            const { from } = ed.state.selection
            let editedId: string | null = null
            ed.state.doc.nodesBetween(Math.max(0, from - 1), from + 1, (node) => {
                if (node.marks) node.marks.forEach(m => { if (m.type.name === 'segment') editedId = m.attrs.segmentId })
            })
            if (editedId) {
                let text = ''
                ed.state.doc.descendants(node => {
                    if (node.isText && node.marks.some(m => m.type.name === 'segment' && m.attrs.segmentId === editedId)) text += node.text
                })
                updateSegment(editedId, text.trim())
                ed.commands.markAsEdited(editedId)
                debouncedSave(editedId, text.trim())
            }
        }
    })

    /* ── Efectos de Sincronización ────────────────────── */

    useEffect(() => { if (editor) editor.setEditable(!soloLectura) }, [editor, soloLectura])

    useEffect(() => {
        if (!editor || segments.length === 0) return
        if (segments.length === prevSegmentCountRef.current) return
        
        const newSegments = segments.slice(prevSegmentCountRef.current)
        prevSegmentCountRef.current = segments.length

        let lastSpeaker = lastConfirmedSpeakerRef.current
        newSegments.forEach(seg => {
            if (seg.speaker_id !== lastSpeaker) {
                const { etiqueta, color } = getSpeakerInfo(seg.speaker_id)
                editor.chain().focus('end').setSpeaker({
                    speakerId: seg.speaker_id,
                    label: etiqueta,
                    color,
                    firstSegmentId: seg.id
                }).run()
                lastSpeaker = seg.speaker_id
                lastConfirmedSpeakerRef.current = lastSpeaker
            }
            const changedIndices = (seg.texto_mejorado && seg.texto_ia) ? computeChangedWordIndices(seg.texto_ia, seg.texto_mejorado) : undefined
            editor.chain().focus('end').insertContent(renderSegmentWords(seg.texto_mejorado || seg.texto_ia, seg.palabras_json, seg.id, changedIndices)).setSegment({
                segmentId: seg.id,
                timestamp: seg.timestamp_inicio,
                editedByUser: seg.editado_por_usuario
            }).run()
        })
    }, [editor, segments, getSpeakerInfo])

    useEffect(() => {
        if (!editor || !provisionalText) {
            editor?.commands.removeProvisional()
            return
        }
        const { etiqueta, color } = getSpeakerInfo(provisionalSpeaker || 'SPEAKER_00')
        // El nodo espera words[] y prevCount para el diffing
        const words = (provisionalText || '').trim().split(/\s+/)
        
        // Intentar update primero, si falla (no existe el nodo), hacer set
        const updated = editor.commands.updateProvisional({
            words,
            prevCount: 0, // En este refactor simplificado pasamos 0, el nodo lo manejará
            speakerId: provisionalSpeaker || 'SPEAKER_00',
            color,
            speakerLabel: provisionalSpeaker !== lastConfirmedSpeakerRef.current ? etiqueta : ''
        })

        if (!updated) {
            editor.commands.setProvisional({
                words,
                prevCount: 0,
                speakerId: provisionalSpeaker || 'SPEAKER_00',
                color,
                speakerLabel: provisionalSpeaker !== lastConfirmedSpeakerRef.current ? etiqueta : ''
            })
        }
    }, [editor, provisionalText, provisionalSpeaker, getSpeakerInfo])

    useEffect(() => {
        if (!editor) return
        editor.commands.highlightActiveSegment(activeSegmentId || '')
    }, [editor, activeSegmentId])

    useImperativeHandle(ref, () => ({
        insertContent: (t) => editor?.chain().focus().insertContent(` ${t} `).run(),
        getEditor: () => editor,
        scrollToEnd: () => containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' }),
        scrollToSegment: (id) => {
            const el = editor?.view.dom.querySelector(`[data-segment-id="${id}"]`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        },
        undo: () => editor?.chain().focus().undo().run(),
        redo: () => editor?.chain().focus().redo().run(),
    }))

    return (
        <div className="flex-1 flex flex-col min-h-0 relative">
            <style>{canvasStyles}</style>
            
            <div 
                ref={containerRef}
                className="flex-1 overflow-y-auto custom-scrollbar relative bg-white"
                style={{ scrollPadding: '100px' }}
            >
                <div className="max-w-[900px] mx-auto py-12 px-10">
                    {/* Indicador de Estado del Documento */}
                    <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }}
                        className="mb-12 pb-8 border-b-2 border-[#1B3A5C] flex items-end justify-between"
                    >
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Scale className="w-5 h-5 text-[#A68246]" />
                                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1B3A5C]/40">Corte Superior de Justicia</span>
                            </div>
                            <h2 className="text-2xl font-bold text-[#1B3A5C]" style={{ fontFamily: 'var(--font-display)' }}>Acta de Audiencia Real</h2>
                        </div>
                        <div className="text-right">
                            <span className="block text-[10px] font-bold text-[#A68246] uppercase mb-1">Transcripción Inteligente</span>
                            <div className="flex items-center gap-2 text-[#1B3A5C]/60 text-xs font-medium">
                                <Activity className="w-3 h-3" />
                                <span>{segments.length} Segmentos Consolidados</span>
                            </div>
                        </div>
                    </motion.div>

                    <EditorContent editor={editor} />
                    
                    {/* Pad inferior para permitir scroll */}
                    <div className="h-[40vh]" />
                </div>
            </div>

            {/* Popovers */}
            <WordCorrectionPopover 
                {...popover} 
                onClose={() => setPopover(prev => ({ ...prev, isOpen: false }))} 
                onSelect={(w) => {
                    editor?.chain().focus().setTextSelection(popover.pos).insertContent(w).run()
                    setPopover(prev => ({ ...prev, isOpen: false }))
                }}
            />

            {/* Speaker Selector Popover */}
            <AnimatePresence>
                {speakerPopover.isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed z-50 bg-white rounded-2xl shadow-2xl border border-[#1B3A5C]/10 p-2 min-w-[240px]"
                        style={{ left: speakerPopover.screenPos.x, top: speakerPopover.screenPos.y }}
                    >
                        <div className="px-3 py-2 border-b border-[#1B3A5C]/5 mb-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-[#1B3A5C]/40">Reasignar Hablante</span>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                            {hablantes.map(h => (
                                <button
                                    key={h.speaker_id}
                                    onClick={() => {
                                        onSpeakerCambiado?.(speakerPopover.firstSegmentId, h.speaker_id)
                                        setSpeakerPopover(prev => ({ ...prev, isOpen: false }))
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#1B3A5C]/5 rounded-xl transition-all text-left group"
                                >
                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ background: h.color }}>
                                        {h.etiqueta.charAt(0)}
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-[#1B3A5C]">{h.nombre || h.etiqueta}</div>
                                        <div className="text-[9px] text-[#1B3A5C]/40 uppercase font-bold tracking-tighter">{h.rol}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
})

TranscriptionCanvas.displayName = 'TranscriptionCanvas'
export default TranscriptionCanvas
