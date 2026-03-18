'use client'

/**
 * TranscriptionCanvas — Editor TipTap para transcripción en tiempo real.
 *
 * Sprint 2 Features:
 * - Edición completa con regla de no-sobreescritura
 * - SpeakerNode con etiquetas del PJ + colores por rol
 * - SegmentMark para click-to-play y tracking de ediciones
 * - Texto provisional (gris → negro) con transición suave
 * - Auto-scroll inteligente (se desactiva con scroll manual, Ctrl+J reactiva)
 * - Debounced API saves para ediciones del usuario
 * - Highlight del segmento activo durante reproducción de audio
 */
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useMemo, useState } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { SpeakerNode, SegmentMark, LowConfidenceMark, BookmarkNode, ProvisionalNode } from '@/extensions'
import WordCorrectionPopover from './WordCorrectionPopover'
import { getSuggestions } from '@/lib/fuzzyMatch'
import { LEGAL_CORPUS } from '@/lib/legalCorpus'
import type { Segmento } from '@/types'

/* ── Palabras gramaticales que NO deben marcarse como baja confianza ── */
const GRAMMAR_WORDS = new Set([
    // Artículos
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    // Preposiciones
    'a', 'de', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre',
    'hacia', 'hasta', 'desde', 'durante', 'mediante', 'según', 'ante', 'bajo',
    // Conjunciones
    'y', 'e', 'o', 'u', 'que', 'si', 'pero', 'sino', 'porque', 'aunque',
    'cuando', 'como', 'donde', 'mientras', 'ni', 'ya',
    // Pronombres
    'yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'ustedes', 'ellos', 'ellas',
    'me', 'te', 'se', 'nos', 'le', 'les', 'lo', 'la', 'los', 'las',
    'mi', 'tu', 'su', 'mis', 'tus', 'sus', 'nuestro', 'nuestra',
    // Demostrativos
    'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
    'aquel', 'aquella', 'aquellos', 'aquellas', 'esto', 'eso', 'aquello',
    // Adverbios comunes
    'no', 'sí', 'muy', 'más', 'menos', 'bien', 'mal', 'aquí', 'allí', 'ahí',
    'hoy', 'ayer', 'mañana', 'ahora', 'siempre', 'nunca', 'también', 'tampoco',
    // Verbos auxiliares/comunes
    'es', 'son', 'fue', 'era', 'ha', 'han', 'he', 'hay', 'ser', 'estar',
    'tiene', 'tienen', 'tengo', 'fue', 'fueron', 'sido', 'siendo',
    // Palabras procesales comunes
    'señor', 'señora', 'doctor', 'doctora', 'juez', 'fiscal',
])

/* ── Sprint 6: Términos legales conocidos excluidos de sugerencias ── */
const KNOWN_LEGAL_TERMS = new Set([
    // Términos procesales
    'audiencia', 'expediente', 'juzgado', 'sala', 'tribunal', 'ministerio',
    'público', 'acusado', 'imputado', 'agraviado', 'testigo', 'perito',
    'defensa', 'técnica', 'abogado', 'letrado', 'procurador', 'demandante',
    'demandado', 'querellante', 'querellado', 'recurrente', 'apelante',
    // Acciones procesales
    'declara', 'manifiesta', 'indica', 'señala', 'solicita', 'requiere',
    'resuelve', 'dispone', 'ordena', 'notifíquese', 'cúmplase', 'archívese',
    'consentida', 'impugnada', 'apelada', 'revocada', 'confirmada',
    // Delitos y términos penales
    'delito', 'pena', 'sanción', 'prisión', 'reparación', 'civil',
    'presunción', 'inocencia', 'culpabilidad', 'tipicidad', 'antijuridicidad',
    // Documentos
    'resolución', 'sentencia', 'auto', 'decreto', 'dictamen', 'requerimiento',
    'acusación', 'denuncia', 'querella', 'demanda', 'contestación',
    // Instituciones
    'cusco', 'corte', 'superior', 'justicia', 'constitucional',
    // Términos jurídicos generales
    'derecho', 'ley', 'código', 'artículo', 'inciso', 'numeral',
    'jurisprudencia', 'doctrina', 'principio', 'garantía', 'debido',
    'proceso', 'procedimiento', 'instancia', 'recurso', 'casación',
])

/* ── Types ──────────────────────────────────────────── */

export interface TranscriptionCanvasHandle {
    insertContent: (text: string) => void
    getEditor: () => ReturnType<typeof useEditor>
    scrollToEnd: () => void
    scrollToSegment: (segmentId: string) => void
}

interface HablanteInfo {
    speaker_id: string
    etiqueta: string
    color: string
    nombre?: string | null
}

interface DocumentInfo {
    expediente?: string
    tipo?: string
    juzgado?: string
    fecha?: string
}

interface PopoverState {
    isOpen: boolean
    word: string
    confidence: number
    pos: { from: number; to: number }
    screenPos: { x: number; y: number }
    segmentId: string
    sentenceContext: string  // Contexto de la frase completa
    alternatives: Array<{ word: string; confidence: number }>  // Alternativas de Deepgram
}

interface CanvasProps {
    /** Si true, el Canvas está en modo solo-lectura (grabación activa). */
    soloLectura: boolean
    /** Lookup de hablantes con rol/etiqueta/color asignado. */
    hablantes?: HablanteInfo[]
    /** Callback cuando el digitador edita un segmento manualmente. */
    onSegmentoEditado?: (segmentoId: string, textoNuevo: string) => void
    /** Callback para saltar a un timestamp en el audio. */
    onSeekAudio?: (timestamp: number) => void
    /** Timestamp actual del audio para highlight. */
    currentAudioTime?: number
    /** Document header info for the Word-like view. */
    documentInfo?: DocumentInfo
}

/* ── Debounce util ──────────────────────────────────── */

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debounced = (...args: any[]) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => fn(...args), ms)
    }
    debounced.cancel = () => { if (timer) clearTimeout(timer) }
    return debounced as T & { cancel: () => void }
}

/* ── Component ──────────────────────────────────────── */

const TranscriptionCanvas = forwardRef<TranscriptionCanvasHandle, CanvasProps>(({
    soloLectura,
    hablantes = [],
    onSegmentoEditado,
    onSeekAudio,
    currentAudioTime = 0,
    documentInfo,
}, ref) => {
    const {
        segments,
        provisionalText,
        provisionalSpeaker,
        provisionalWords,
        activeSegmentId,
        editedSegmentIds,
        updateSegment,
    } = useCanvasStore()

    const [popover, setPopover] = useState<PopoverState>({
        isOpen: false,
        word: '',
        confidence: 0,
        pos: { from: 0, to: 0 },
        screenPos: { x: 0, y: 0 },
        segmentId: '',
        sentenceContext: '',
        alternatives: [],
    })

    const prevSegmentCountRef = useRef(0)
    const prevProvisionalWordCountRef = useRef(0)
    const autoScrollRef = useRef(true)
    const containerRef = useRef<HTMLDivElement>(null)

    // Build speaker lookup map for O(1) access
    const speakerMap = useMemo(() => {
        const map = new Map<string, HablanteInfo>()
        hablantes.forEach(h => map.set(h.speaker_id, h))
        return map
    }, [hablantes])

    // Debounced save — fires 800ms after user stops editing
    const debouncedSave = useMemo(
        () =>
            debounce((segId: string, text: string) => {
                onSegmentoEditado?.(segId, text)
            }, 800),
        [onSegmentoEditado]
    )

    // Cleanup debounce on unmount
    useEffect(() => () => debouncedSave.cancel(), [debouncedSave])

    // Get speaker label and color from the lookup map (or fallback to defaults)
    const getSpeakerInfo = useCallback((speakerId: string) => {
        const info = speakerMap.get(speakerId)
        if (info) {
            // Combinar etiqueta + nombre si está disponible: "JUEZ: Edmil Jampier"
            const label = info.nombre
                ? `${info.etiqueta} ${info.nombre}`
                : info.etiqueta
            return { etiqueta: label, color: info.color }
        }
        // Fallback: cycle through a palette
        const colors = ['#1B3A5C', '#2D6A4F', '#9B2226', '#BC6C25', '#6B21A8', '#0E7490', '#64748B', '#DB2777']
        const idx = parseInt(speakerId.replace(/\D/g, ''), 10) || 0
        return { etiqueta: speakerId.toUpperCase() + ':', color: colors[idx % colors.length] }
    }, [speakerMap])

    /* ── TipTap editor ──────────────────────────────── */

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ heading: false }),
            Placeholder.configure({
                placeholder: soloLectura
                    ? 'Iniciando transcripción...'
                    : 'La transcripción aparecerá aquí. Puedes editar el texto libremente.',
            }),
            SpeakerNode,
            SegmentMark,
            LowConfidenceMark,
            BookmarkNode,
            ProvisionalNode,
        ],
        editable: !soloLectura,
        content: '',
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: 'focus:outline-none min-h-[600px] w-full',
            },
            handleClick: (view, pos, event) => {
                const target = event.target as HTMLElement

                // 1. Check for low-confidence words
                const lowConfEl = target.closest('[data-low-confidence="true"]') as HTMLElement
                if (lowConfEl) {
                    const word = lowConfEl.innerText.trim()
                    const confidence = parseFloat(lowConfEl.getAttribute('data-confidence') || '0')
                    const segmentEl = target.closest('[data-segment-id]') as HTMLElement
                    const segmentId = segmentEl?.getAttribute('data-segment-id') || ''

                    // Obtener el contexto de la frase (texto del segmento)
                    const sentenceContext = segmentEl?.textContent?.trim() || ''

                    // Buscar el segmento en el store para obtener alternativas
                    const segmentData = segments.find(s => s.id === segmentId)
                    let alternatives: Array<{ word: string; confidence: number }> = []

                    if (segmentData?.palabras_json) {
                        // Buscar la palabra en palabras_json para obtener alternativas
                        const wordData = segmentData.palabras_json.find(
                            (w: any) => w.word.toLowerCase() === word.toLowerCase()
                        )
                        if (wordData?.alternatives) {
                            alternatives = wordData.alternatives.map((alt: any) => ({
                                word: alt.word || alt,
                                confidence: alt.confidence || 0.8
                            }))
                        }
                    }

                    // Find Prosemirror position for replacement
                    const nodePos = view.posAtDOM(lowConfEl, 0)
                    const nodeSize = lowConfEl.innerText.length

                    setPopover({
                        isOpen: true,
                        word,
                        confidence,
                        pos: { from: nodePos, to: nodePos + nodeSize },
                        screenPos: { x: event.clientX, y: event.clientY },
                        segmentId,
                        sentenceContext,
                        alternatives,
                    })
                    return true
                }

                // 2. Check for segment clicks (seek audio)
                const segmentEl = target.closest('[data-segment-id]') as HTMLElement
                if (segmentEl && onSeekAudio) {
                    const timestamp = parseFloat(segmentEl.getAttribute('data-timestamp') || '0')
                    if (timestamp > 0) {
                        onSeekAudio(timestamp)
                        return true
                    }
                }
                return false
            },
        },
        onUpdate: ({ editor: ed }) => {
            if (soloLectura || !onSegmentoEditado) return

            // Find which segment the cursor is currently inside
            const { from } = ed.state.selection
            let editedSegmentId: string | null = null

            ed.state.doc.nodesBetween(Math.max(0, from - 1), from + 1, (node) => {
                if (node.marks) {
                    node.marks.forEach((mark) => {
                        if (mark.type.name === 'segment' && mark.attrs.segmentId) {
                            editedSegmentId = mark.attrs.segmentId
                        }
                    })
                }
            })

            if (editedSegmentId) {
                // Extract text within this specific segment mark
                let segText = ''
                ed.state.doc.descendants((node) => {
                    if (node.isText) {
                        const hasMark = node.marks.some(
                            m => m.type.name === 'segment' && m.attrs.segmentId === editedSegmentId
                        )
                        if (hasMark) segText += node.text
                    }
                })

                // Update store (marks as editado_por_usuario)
                updateSegment(editedSegmentId, segText.trim())

                // Mark the segment in TipTap as edited
                ed.commands.markAsEdited(editedSegmentId)

                // Debounced API save
                debouncedSave(editedSegmentId, segText.trim())
            }
        },
    })

    // Update editable when soloLectura changes
    useEffect(() => {
        if (editor) editor.setEditable(!soloLectura)
    }, [editor, soloLectura])

    /* ── Sync SpeakerNode labels when hablantes change ─ */

    useEffect(() => {
        if (!editor || hablantes.length === 0) return

        const { doc, tr } = editor.state
        let modified = false

        doc.descendants((node, pos) => {
            if (node.type.name === 'speakerNode') {
                const speakerId = node.attrs.speakerId
                const { etiqueta, color } = getSpeakerInfo(speakerId)

                // Only update if label or color actually changed
                if (node.attrs.label !== etiqueta || node.attrs.color !== color) {
                    tr.setNodeMarkup(pos, undefined, {
                        ...node.attrs,
                        label: etiqueta,
                        color,
                    })
                    modified = true
                }
            }
        })

        if (modified) {
            editor.view.dispatch(tr)
        }
    }, [editor, speakerMap, hablantes, getSpeakerInfo])

    /* ── Imperative handle ──────────────────────────── */

    useImperativeHandle(ref, () => ({
        insertContent: (text: string) => {
            if (editor) {
                editor.chain().focus().insertContent(` ${text} `).run()
            }
        },
        getEditor: () => editor,
        scrollToEnd: () => {
            autoScrollRef.current = true
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight })
        },
        scrollToSegment: (segmentId: string) => {
            if (editor) {
                const target = editor.view.dom.querySelector(`[data-segment-id="${segmentId}"]`)
                target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        },
    }))

    /* ── Append new segments ────────────────────────── */

    useEffect(() => {
        if (!editor || segments.length === 0) return
        if (segments.length <= prevSegmentCountRef.current) return

        const nuevos = segments.slice(prevSegmentCountRef.current)
        const prevCount = prevSegmentCountRef.current
        prevSegmentCountRef.current = segments.length

        // Resetear contador de palabras provisionales
        prevProvisionalWordCountRef.current = 0

        // Determinar si el primer segmento nuevo es del mismo speaker que el último existente
        const lastExistingSeg = prevCount > 0 ? segments[prevCount - 1] : null
        const firstNewSeg = nuevos[0]

        const htmlParts: string[] = []

        nuevos.forEach((seg) => {
            const globalIdx = segments.indexOf(seg)
            const prevSeg = globalIdx > 0 ? segments[globalIdx - 1] : null
            const newSpeaker = prevSeg?.speaker_id !== seg.speaker_id
            const { etiqueta, color } = getSpeakerInfo(seg.speaker_id)
            const texto = seg.texto_editado || seg.texto_mejorado || seg.texto_ia
            const isEdited = editedSegmentIds.includes(seg.id)
            const timestamp = seg.timestamp_inicio || 0

            const classes = ['segment-clickable']
            if (isEdited) classes.push('segment-edited')

            if (newSpeaker) {
                htmlParts.push(`<speaker-label speakerId="${seg.speaker_id}" label="${etiqueta}" color="${color}"></speaker-label>`)
            }

            let segmentHtml = ''
            if (seg.palabras_json && seg.palabras_json.length > 0) {
                seg.palabras_json.forEach((wordObj: any) => {
                    const wordText = wordObj.word
                    const conf = wordObj.confidence
                    const wordLower = wordText.toLowerCase().replace(/[.,;:!?]/g, '')
                    const shouldMark = conf < 0.85 &&
                        !GRAMMAR_WORDS.has(wordLower) &&
                        !KNOWN_LEGAL_TERMS.has(wordLower) &&
                        wordLower.length > 2
                    if (shouldMark) {
                        const confPercent = Math.round(conf * 100)
                        segmentHtml += `<span class="text-low-confidence" data-low-confidence="true" data-confidence="${conf}" data-segment-id="${seg.id}" title="Confianza: ${confPercent}%">${wordText}</span> `
                    } else {
                        segmentHtml += `${wordText} `
                    }
                })
            } else {
                segmentHtml = texto + ' '
            }

            const segmentClasses = ['segment-text', ...classes]
            htmlParts.push(`<span class="${segmentClasses.join(' ')}" data-segment-id="${seg.id}" data-timestamp="${timestamp}" data-edited="${isEdited}">${segmentHtml}</span>`)
        })

        // Una sola transacción: elimina el provisional + inserta el texto confirmado
        // Esto evita el flash intermedio donde el provisional desaparece antes de que
        // aparezca el texto definitivo.
        const html = htmlParts.join('')
        editor.chain()
            .removeProvisional()
            .focus('end', { scrollIntoView: false })
            .insertContent(html)
            .run()

        // Auto-scroll: During streaming, scroll to bottom after DOM update.
        // During initial bulk load (many segments at once), scroll to top.
        const isBulkLoad = prevCount === 0 && nuevos.length > 5
        // Double-rAF: primer frame TipTap commitea el DOM, segundo frame el browser recalcula layout
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const el = containerRef.current
            if (!el) return
            if (isBulkLoad) {
                el.scrollTop = 0
            } else if (autoScrollRef.current) {
                el.scrollTop = el.scrollHeight
            }
        }))
    }, [editor, segments, editedSegmentIds, getSpeakerInfo])

    /* ── Active segment highlighting during playback ── */

    useEffect(() => {
        if (!editor) return

        // Clear previous
        editor.view.dom.querySelectorAll('.segment-active').forEach(el =>
            el.classList.remove('segment-active')
        )

        if (activeSegmentId) {
            const el = editor.view.dom.querySelector(`[data-segment-id="${activeSegmentId}"]`)
            if (el) {
                el.classList.add('segment-active')
                // Only scroll if auto-scroll is on
                if (autoScrollRef.current) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
            }
        }
    }, [editor, activeSegmentId])

    /* ── Provisional text — aparición palabra por palabra ── */

    useEffect(() => {
        if (!editor) return

        // Sin texto provisional → limpiar y resetear contador
        if (!provisionalText || !provisionalText.trim()) {
            // Si hay nuevos segmentos entrando al mismo tiempo, el efecto de segmentos
            // ya maneja el removeProvisional en su chain. Aquí solo reseteamos el contador.
            const hasPendingSegments = segments.length > prevSegmentCountRef.current
            if (!hasPendingSegments) {
                editor.commands.removeProvisional()
            }
            prevProvisionalWordCountRef.current = 0
            return
        }

        const { color } = getSpeakerInfo(provisionalSpeaker || 'SPEAKER_00')
        const prevCount = prevProvisionalWordCountRef.current

        // Construir HTML: palabras ya vistas → sin animación, palabras nuevas → fadeInWord
        let displayText = provisionalText
        if (provisionalWords && provisionalWords.length > 0) {
            displayText = provisionalWords.map((w, i) =>
                i >= prevCount
                    ? `<span class="provisional-word">${w.word}</span>`
                    : `<span class="provisional-word--stable">${w.word}</span>`
            ).join(' ')
            prevProvisionalWordCountRef.current = provisionalWords.length
        }

        const attrs = {
            text: displayText,
            speakerId: provisionalSpeaker || 'SPEAKER_00',
            color,
        }

        // Intentar actualizar in-place (no destruye el DOM, no reinicia animaciones)
        // Si no existe nodo provisional, insertarlo al final
        const updated = editor.commands.updateProvisional(attrs)
        if (!updated) {
            editor.chain().focus('end', { scrollIntoView: false }).setProvisional(attrs).run()
        }

        if (autoScrollRef.current) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const el = containerRef.current
                if (el) el.scrollTop = el.scrollHeight
            }))
        }
    }, [editor, provisionalText, provisionalSpeaker, provisionalWords, segments, getSpeakerInfo])

    /* ── Smart auto-scroll control ──────────────────── */

    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const onScroll = () => {
            const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            autoScrollRef.current = isNearBottom
        }

        el.addEventListener('scroll', onScroll, { passive: true })
        return () => el.removeEventListener('scroll', onScroll)
    }, [editor])

    // Ctrl+J = scroll to end
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'j') {
                e.preventDefault()
                autoScrollRef.current = true
                containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight })
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [editor])

    /* ── Render ──────────────────────────────────────── */

    const handleCorrectionSelect = (newWord: string) => {
        if (!editor) return

        // Replace the low-confidence word in the editor
        editor.chain()
            .focus()
            .deleteRange({ from: popover.pos.from, to: popover.pos.to })
            .insertContent(newWord)
            .run()

        // After TipTap update, trigger onUpdate to sync with store/backend
        const updatedText = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ')
        // (Simplified text extraction — in onUpdate we already handle this by segment)

        setPopover(prev => ({ ...prev, isOpen: false }))
    }

    const handleCorrectionAccept = () => {
        if (!editor) return

        // Mark this word as accepted (remove low-confidence styling)
        // We can just unset the mark or similar.
        // Actually, since we're using raw HTML for initial rendering,
        // we might just want to remove the class.
        // But TipTap doesn't "know" about the span class if it's not a Mark.

        // For now, let's just close the popover.
        // In a more advanced version, we'd clear the mark.
        setPopover(prev => ({ ...prev, isOpen: false }))
    }

    const docDate = documentInfo?.fecha || new Date().toLocaleDateString('es-PE', {
        year: 'numeric', month: 'long', day: 'numeric'
    })

    return (
        <div ref={containerRef} className="canvas-scroll-area">
        <div className="canvas-page-area">
            <div className="canvas-document">
                {/* Document header — mimics official PJ header */}
                <div className="canvas-document__header">
                    <div className="canvas-document__title">
                        {documentInfo?.tipo || 'Acta de Audiencia'}
                    </div>
                    <div className="canvas-document__meta">
                        <span>{documentInfo?.juzgado || 'Juzgado Penal Unipersonal'}</span>
                        <span>{documentInfo?.expediente ? `Exp. ${documentInfo.expediente}` : ''}</span>
                        <span>{docDate}</span>
                    </div>
                </div>

                {/* TipTap editor */}
                <div className="canvas-editor">
                    <EditorContent editor={editor} />
                </div>

                {/* Correction Popover */}
                <WordCorrectionPopover
                    isOpen={popover.isOpen}
                    originalWord={popover.word}
                    confidence={popover.confidence}
                    position={popover.screenPos}
                    sentenceContext={popover.sentenceContext}
                    alternatives={[
                        ...popover.alternatives,
                        ...getSuggestions(popover.word, LEGAL_CORPUS)
                    ]}
                    onSelect={handleCorrectionSelect}
                    onAccept={handleCorrectionAccept}
                    onClose={() => setPopover(prev => ({ ...prev, isOpen: false }))}
                />

                {/* Scroll indicator — shows when auto-scroll is off */}
                {!autoScrollRef.current && segments.length > 3 && (
                    <button
                        onClick={() => {
                            autoScrollRef.current = true
                            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight })
                        }}
                        className="fixed bottom-20 right-[30%] px-3 py-1.5 rounded-full text-xs z-10 transition-all hover:brightness-110"
                        style={{
                            background: 'var(--accent-primary)',
                            color: '#FFFFFF',
                            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
                        }}
                    >
                        ↓ Ir al final (Ctrl+J)
                    </button>
                )}
            </div>
        </div>
        </div>
    )
})

TranscriptionCanvas.displayName = 'TranscriptionCanvas'

export default TranscriptionCanvas
