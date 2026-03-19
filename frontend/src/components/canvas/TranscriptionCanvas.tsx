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
    undo: () => void
    redo: () => void
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

interface SpeakerPopoverState {
    isOpen: boolean
    firstSegmentId: string
    currentSpeakerId: string
    screenPos: { x: number; y: number }
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
    /** Callback cuando el digitador cambia el hablante de un grupo de segmentos (click en label). */
    onSpeakerCambiado?: (firstSegmentId: string, newSpeakerId: string) => void
    /** Callback cuando el digitador reasigna segmentos seleccionados a un hablante. */
    onReasignarSegmentos?: (segmentIds: string[], newSpeakerId: string) => void
}

/* ── Render helper: texto mejorado + confidence marks ── */
/**
 * Renders a segment using the improved text (texto_mejorado/texto_ia) for display,
 * but uses palabras_json only for confidence lookups.
 * This ensures Claude's capitalization and punctuation are always visible.
 */
function renderSegmentWords(
    texto: string,
    palabrasJson: any[] | null,
    segId: string,
): string {
    if (!texto) return ''

    // Build a confidence lookup from palabras_json: normalized-word → min confidence
    const confMap = new Map<string, number>()
    if (palabrasJson && palabrasJson.length > 0) {
        for (const w of palabrasJson) {
            const key = (w.word || '').toLowerCase().replace(/[.,;:!?¡¿«»\-]/g, '')
            if (key && (confMap.get(key) === undefined || w.confidence < confMap.get(key)!)) {
                confMap.set(key, w.confidence)
            }
        }
    }

    const words = texto.trim().split(/\s+/)
    return words.map(wordText => {
        const key = wordText.toLowerCase().replace(/[.,;:!?¡¿«»\-]/g, '')
        const conf = confMap.size > 0 ? (confMap.get(key) ?? 1.0) : 1.0
        const shouldMark = conf < 0.85 &&
            !GRAMMAR_WORDS.has(key) &&
            !KNOWN_LEGAL_TERMS.has(key) &&
            key.length > 2
        if (shouldMark) {
            const confPercent = Math.round(conf * 100)
            return `<span class="text-low-confidence" data-low-confidence="true" data-confidence="${conf}" data-segment-id="${segId}" title="Confianza: ${confPercent}%">${wordText}</span>`
        }
        return wordText
    }).join(' ') + ' '
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
    onSpeakerCambiado,
    onReasignarSegmentos,
}, ref) => {
    const {
        segments,
        provisionalText,
        provisionalSpeaker,
        provisionalWords,
        activeSegmentId,
        editedSegmentIds,
        lastConsolidatedSegmentId,
        updateSegment,
        clearLastConsolidated,
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

    const [speakerPopover, setSpeakerPopover] = useState<SpeakerPopoverState>({
        isOpen: false,
        firstSegmentId: '',
        currentSpeakerId: '',
        screenPos: { x: 0, y: 0 },
    })

    const [selectionToolbar, setSelectionToolbar] = useState<{
        isActive: boolean
        segmentIds: string[]
        pos: { x: number; y: number }
    }>({ isActive: false, segmentIds: [], pos: { x: 0, y: 0 } })

    const prevSegmentCountRef = useRef(0)
    const prevSegmentIdsRef = useRef<string[]>([])
    const prevHablantesJSONRef = useRef("")
    const prevProvisionalWordCountRef = useRef(0)
    const autoScrollRef = useRef(true)
    const containerRef = useRef<HTMLDivElement>(null)
    // Tracks last confirmed segment speaker — read by provisional effect without adding
    // `segments` to its deps (which would cause provisional re-insertion on each segment add).
    const lastConfirmedSpeakerRef = useRef<string | null>(null)

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

                // 0. Check for speaker-label clicks (change speaker assignment)
                const speakerLabelEl = target.closest('speaker-label') as HTMLElement
                if (speakerLabelEl && onSpeakerCambiado) {
                    const firstSegmentId = speakerLabelEl.getAttribute('data-first-segment-id') || ''
                    const currentSpeakerId = speakerLabelEl.getAttribute('data-speaker-id') || ''
                    setSpeakerPopover({
                        isOpen: true,
                        firstSegmentId,
                        currentSpeakerId,
                        screenPos: { x: event.clientX, y: event.clientY },
                    })
                    return true
                }

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
        undo: () => { editor?.chain().focus().undo().run() },
        redo: () => { editor?.chain().focus().redo().run() },
    }))

    /* ── Append new segments / Handle replacements ──── */

    useEffect(() => {
        if (!editor || segments.length === 0) return

        // Always keep ref up-to-date for provisional speaker-change detection
        lastConfirmedSpeakerRef.current = segments.at(-1)?.speaker_id ?? null

        const currentIds = segments.map(s => s.id)
        const prevIds = prevSegmentIdsRef.current

        // Detectar si cambió la info de los hablantes (roles, nombres, colores)
        const currentHablantesJSON = JSON.stringify(hablantes)
        const speakersUpdated = prevHablantesJSONRef.current !== "" && prevHablantesJSONRef.current !== currentHablantesJSON
        prevHablantesJSONRef.current = currentHablantesJSON

        // Detectar si hubo un reemplazo (IDs cambiaron en el medio, no solo al final)
        const isReplacement = (prevIds.length > 0 && (
            // Segmentos disminuyeron o IDs cambiaron (no solo append)
            segments.length < prevIds.length ||
            prevIds.some((id, i) => i < currentIds.length && currentIds[i] !== id)
        )) || speakersUpdated

        if (isReplacement) {
            const missingIds = prevIds.filter(id => !currentIds.includes(id))
            const addedIds = currentIds.filter(id => !prevIds.includes(id))

            // Reemplazo localizado de segmentos en vivo de Claude
            if (!speakersUpdated && missingIds.length > 0 && addedIds.length > 0) {
                let from = -1
                let to = -1
                
                editor.state.doc.descendants((node, pos) => {
                    if (node.isText && node.marks) {
                        const segId = node.marks.find(m => m.type.name === 'segment')?.attrs?.segmentId
                        if (segId && missingIds.includes(segId)) {
                            if (from === -1) from = pos
                            to = Math.max(to, pos + node.nodeSize)
                        }
                    }
                })

                if (from !== -1 && to !== -1) {
                    const htmlParts: string[] = []
                    const newAddedSegments = segments.filter(s => addedIds.includes(s.id))
                    
                    newAddedSegments.forEach((seg) => {
                        const globalIdx = segments.indexOf(seg)
                        const prevSeg = globalIdx > 0 ? segments[globalIdx - 1] : null
                        const newSpeaker = prevSeg?.speaker_id !== seg.speaker_id
                        const { etiqueta, color } = getSpeakerInfo(seg.speaker_id)
                        const texto = seg.texto_editado || seg.texto_mejorado || seg.texto_ia
                        const isEdited = editedSegmentIds.includes(seg.id)
                        const timestamp = seg.timestamp_inicio || 0

                        const classes = ['segment-clickable', 'segment-confirming']
                        if (isEdited) classes.push('segment-edited')

                        if (newSpeaker) {
                            htmlParts.push(`<speaker-label speakerId="${seg.speaker_id}" label="${etiqueta}" color="${color}" data-first-segment-id="${seg.id}"></speaker-label>`)
                        }

                        const segmentHtml = renderSegmentWords(texto, seg.palabras_json, seg.id)

                        const segmentClasses = ['segment-text', ...classes]
                        htmlParts.push(`<span class="${segmentClasses.join(' ')}" data-segment-id="${seg.id}" data-timestamp="${timestamp}" data-edited="${isEdited}">${segmentHtml}</span>`)
                    })

                    const html = htmlParts.join(' ')
                    
                    // Solo eliminar y reemplazar el pedazo modificado, no todo el documento!
                    editor.chain()
                        .deleteRange({ from, to })
                        .insertContentAt(from, html)
                        .run()

                    prevSegmentCountRef.current = segments.length
                    prevSegmentIdsRef.current = currentIds
                    return
                }
            }

            // Fallback: Re-render completo si no pudo hacer reemplazo localizado
            prevSegmentCountRef.current = segments.length
            prevSegmentIdsRef.current = currentIds
            prevProvisionalWordCountRef.current = 0

            const htmlParts: string[] = []
            segments.forEach((seg, idx) => {
                const prevSeg = idx > 0 ? segments[idx - 1] : null
                const newSpeaker = prevSeg?.speaker_id !== seg.speaker_id
                const { etiqueta, color } = getSpeakerInfo(seg.speaker_id)
                const texto = seg.texto_editado || seg.texto_mejorado || seg.texto_ia
                const isEdited = editedSegmentIds.includes(seg.id)
                const timestamp = seg.timestamp_inicio || 0

                const classes = ['segment-clickable']
                if (isEdited) classes.push('segment-edited')

                if (newSpeaker) {
                    htmlParts.push(`<speaker-label speakerId="${seg.speaker_id}" label="${etiqueta}" color="${color}" data-first-segment-id="${seg.id}"></speaker-label>`)
                }

                const segmentHtml = renderSegmentWords(texto, seg.palabras_json, seg.id)

                const segmentClasses = ['segment-text', ...classes]
                htmlParts.push(`<span class="${segmentClasses.join(' ')}" data-segment-id="${seg.id}" data-timestamp="${timestamp}" data-edited="${isEdited}">${segmentHtml}</span>`)
            })

            const html = htmlParts.join(' ')

            // Fix scroll jumping on replace
            const el = containerRef.current
            const currentScrollTop = el ? el.scrollTop : undefined
            const currentScrollHeight = el ? el.scrollHeight : undefined

            editor.chain()
                .removeProvisional()
                .setContent(html, false)
                .run()
            
            // Inmediate restore scroll if possible to avoid flicker
            if (el && currentScrollTop !== undefined) {
                if (!autoScrollRef.current) el.scrollTop = currentScrollTop
            }

            // Restore scroll position after React/TipTap layout settles
            requestAnimationFrame(() => requestAnimationFrame(() => {
                if (!el || currentScrollTop === undefined || currentScrollHeight === undefined) return
                if (autoScrollRef.current) {
                    el.scrollTop = el.scrollHeight
                } else {
                    el.scrollTop = currentScrollTop
                }
            }))

            return
        }

        // Normal flow: solo nuevos segmentos al final
        if (segments.length <= prevSegmentCountRef.current) return

        const nuevos = segments.slice(prevSegmentCountRef.current)
        const prevCount = prevSegmentCountRef.current
        prevSegmentCountRef.current = segments.length
        prevSegmentIdsRef.current = currentIds

        // Resetear contador de palabras provisionales
        prevProvisionalWordCountRef.current = 0

        // Bulk load: primera carga de muchos segmentos (ej. al reanudar transcripción)
        const isBulkLoad = prevCount === 0 && nuevos.length > 5

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
            // Durante streaming (no bulk): animación de solidificación (opacity 0.75→1)
            // para transición suave desde texto provisional al texto confirmado.
            if (!isBulkLoad) classes.push('segment-confirming')

            if (newSpeaker) {
                htmlParts.push(`<speaker-label speakerId="${seg.speaker_id}" label="${etiqueta}" color="${color}"></speaker-label>`)
            }

            const segmentHtml = renderSegmentWords(texto, seg.palabras_json, seg.id)

            const segmentClasses = ['segment-text', ...classes]
            htmlParts.push(`<span class="${segmentClasses.join(' ')}" data-segment-id="${seg.id}" data-timestamp="${timestamp}" data-edited="${isEdited}">${segmentHtml}</span>`)
        })

        // Una sola transacción: elimina el provisional + inserta el texto confirmado.
        // El texto confirmado aparece con segment-confirming (opacity 0.75→1) creando
        // continuidad visual con el texto provisional (opacity 0.75).
        const html = htmlParts.join(' ')
        editor.chain()
            .removeProvisional()
            .focus('end', { scrollIntoView: false })
            .insertContent(html)
            .run()

        // Auto-scroll: During streaming, scroll to bottom after DOM update.
        // During initial bulk load (many segments at once), scroll to top.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const el = containerRef.current
            if (!el) return
            if (isBulkLoad) {
                el.scrollTop = 0
            } else if (autoScrollRef.current) {
                el.scrollTop = el.scrollHeight
            }
        }))
    }, [editor, segments, editedSegmentIds, getSpeakerInfo, hablantes])

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

    /* ── Consolidated segment update — actualiza DOM cuando un segmento se extiende in-place ── */

    useEffect(() => {
        if (!editor || !lastConsolidatedSegmentId) return

        const seg = segments.find(s => s.id === lastConsolidatedSegmentId)
        if (!seg) return

        // Encontrar el span en el DOM y actualizar su contenido directamente.
        // No modifica el ProseMirror state (evita conflicto con provisional in-flight).
        const domEl = editor.view.dom.querySelector(`[data-segment-id="${lastConsolidatedSegmentId}"]`) as HTMLElement
        if (!domEl) return

        getSpeakerInfo(seg.speaker_id)  // keep dependency tracked
        const texto = seg.texto_editado || seg.texto_mejorado || seg.texto_ia
        const newHtml = renderSegmentWords(texto, seg.palabras_json, seg.id)
        domEl.innerHTML = newHtml

        // También removeProvisional porque addSegment lo marcó como consolidado
        editor.commands.removeProvisional()
        prevProvisionalWordCountRef.current = 0
        // Limpiar para evitar que el efecto se re-ejecute con datos viejos
        clearLastConsolidated()
    }, [editor, lastConsolidatedSegmentId, segments, getSpeakerInfo, clearLastConsolidated])

    /* ── Provisional text — aparición palabra por palabra ── */

    useEffect(() => {
        if (!editor) return

        // Sin texto provisional → limpiar nodo y resetear contador de palabras vistas.
        // NOTA: `segments` NO está en los deps de este efecto a propósito.
        // Antes estaba y causaba que, al llegar un segmento final, este efecto
        // volviera a correr con el provisionalText viejo (aún sin limpiar) y
        // re-insertaba el nodo provisional encima del texto confirmado.
        if (!provisionalText || !provisionalText.trim()) {
            editor.commands.removeProvisional()   // no-op si ya fue removido
            prevProvisionalWordCountRef.current = 0
            return
        }

        const currentSpeakerId = provisionalSpeaker || 'SPEAKER_00'
        const { etiqueta, color } = getSpeakerInfo(currentSpeakerId)

        // Show speaker label when the provisional speaker differs from the last confirmed speaker.
        // lastConfirmedSpeakerRef is updated in the segments effect (no dep needed here).
        const isSpeakerChange = lastConfirmedSpeakerRef.current !== null &&
            currentSpeakerId !== lastConfirmedSpeakerRef.current
        const speakerLabel = isSpeakerChange ? etiqueta : ''

        // Palabras actuales: preferir provisionalWords (con datos de Deepgram),
        // fallback a split del texto crudo.
        const words = (provisionalWords && provisionalWords.length > 0)
            ? provisionalWords.map(w => w.word)
            : (provisionalText || '').trim().split(/\s+/).filter(Boolean)

        // prevCount = cuántas palabras ya estaban en pantalla (no se animan de nuevo)
        const prevCount = Math.min(prevProvisionalWordCountRef.current, words.length)

        const attrs = {
            words,
            prevCount,
            speakerId: currentSpeakerId,
            color,
            speakerLabel,
        }

        // Actualizar ref ANTES del DOM update para evitar loops
        prevProvisionalWordCountRef.current = words.length

        // Actualizar nodo in-place (nodeView hace DOM-diff: solo añade spans nuevos).
        // Si no existe todavía, insertarlo al final.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor, provisionalText, provisionalSpeaker, provisionalWords, getSpeakerInfo])
    // ↑ `segments` eliminado intencionalmente de los deps. Ver comentario arriba.

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

    /* ── Text selection toolbar ─────────────────────── */

    useEffect(() => {
        if (!editor || !onReasignarSegmentos) return

        let debounceTimer: ReturnType<typeof setTimeout> | null = null

        const handleSelectionChange = () => {
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(() => {
                const sel = window.getSelection()
                if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
                    setSelectionToolbar(prev => prev.isActive ? { ...prev, isActive: false } : prev)
                    return
                }
                const range = sel.getRangeAt(0)
                const editorDom = editor.view.dom
                if (!editorDom.contains(range.commonAncestorContainer)) {
                    setSelectionToolbar(prev => prev.isActive ? { ...prev, isActive: false } : prev)
                    return
                }
                const ids = new Set<string>()
                editorDom.querySelectorAll('[data-segment-id]').forEach(el => {
                    // Only top-level segment spans (not low-confidence inner spans)
                    if (el.closest('[data-segment-id]') !== el) return
                    if (range.intersectsNode(el)) {
                        const sid = el.getAttribute('data-segment-id')
                        if (sid) ids.add(sid)
                    }
                })
                if (ids.size === 0) {
                    setSelectionToolbar(prev => prev.isActive ? { ...prev, isActive: false } : prev)
                    return
                }
                const rect = range.getBoundingClientRect()
                setSelectionToolbar({
                    isActive: true,
                    segmentIds: Array.from(ids),
                    pos: { x: rect.left + rect.width / 2, y: rect.top },
                })
            }, 120)
        }

        document.addEventListener('selectionchange', handleSelectionChange)
        return () => {
            document.removeEventListener('selectionchange', handleSelectionChange)
            if (debounceTimer) clearTimeout(debounceTimer)
        }
    }, [editor, onReasignarSegmentos])

    /* ── Imperative handle ──────────────────────────── */

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

                {/* Speaker Selection Popover */}
                {speakerPopover.isOpen && onSpeakerCambiado && (
                    <>
                        {/* Backdrop */}
                        <div
                            className="fixed inset-0 z-40"
                            onClick={() => setSpeakerPopover(prev => ({ ...prev, isOpen: false }))}
                        />
                        <div
                            className="fixed z-50 min-w-[200px] py-1 shadow-xl"
                            style={{
                                left: Math.min(speakerPopover.screenPos.x, window.innerWidth - 220),
                                top: speakerPopover.screenPos.y + 8,
                                background: 'var(--bg-surface)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '4px',
                            }}
                        >
                            <p
                                className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
                                style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}
                            >
                                Reasignar hablante
                            </p>
                            {hablantes.length === 0 ? (
                                <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    Sin hablantes registrados
                                </p>
                            ) : (
                                hablantes.map(h => (
                                    <button
                                        key={h.speaker_id}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:brightness-110 transition-all"
                                        style={{
                                            background: h.speaker_id === speakerPopover.currentSpeakerId
                                                ? `${h.color}20`
                                                : 'transparent',
                                            color: 'var(--text-primary)',
                                        }}
                                        onClick={() => {
                                            setSpeakerPopover(prev => ({ ...prev, isOpen: false }))
                                            if (h.speaker_id !== speakerPopover.currentSpeakerId) {
                                                onSpeakerCambiado(speakerPopover.firstSegmentId, h.speaker_id)
                                            }
                                        }}
                                    >
                                        <span
                                            className="w-2.5 h-2.5 rounded-full shrink-0"
                                            style={{ background: h.color }}
                                        />
                                        <span className="text-[11px] font-medium">{h.etiqueta}</span>
                                        {h.nombre && (
                                            <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                                                {h.nombre}
                                            </span>
                                        )}
                                        {h.speaker_id === speakerPopover.currentSpeakerId && (
                                            <span className="text-[9px] ml-auto" style={{ color: h.color }}>✓</span>
                                        )}
                                    </button>
                                ))
                            )}
                        </div>
                    </>
                )}

                {/* Selection toolbar — assign selected segments to a speaker */}
                {selectionToolbar.isActive && onReasignarSegmentos && hablantes.length > 0 && (
                    <div
                        className="fixed z-50 flex items-center gap-0.5 px-2 py-1.5 shadow-xl"
                        style={{
                            left: Math.max(8, Math.min(selectionToolbar.pos.x - 120, window.innerWidth - 280)),
                            top: Math.max(8, selectionToolbar.pos.y - 48),
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            pointerEvents: 'auto',
                        }}
                    >
                        <span
                            className="text-[9px] font-bold uppercase tracking-widest pr-1.5 mr-1 shrink-0"
                            style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--border-subtle)' }}
                        >
                            Asignar a
                        </span>
                        {hablantes.map(h => (
                            <button
                                key={h.speaker_id}
                                title={h.etiqueta + (h.nombre ? ` — ${h.nombre}` : '')}
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded hover:brightness-110 transition-all"
                                style={{ background: `${h.color}18`, color: h.color, border: `1px solid ${h.color}40` }}
                                onMouseDown={(e) => {
                                    e.preventDefault() // Keep browser selection alive
                                    const ids = [...selectionToolbar.segmentIds]
                                    setSelectionToolbar({ isActive: false, segmentIds: [], pos: { x: 0, y: 0 } })
                                    window.getSelection()?.removeAllRanges()
                                    onReasignarSegmentos(ids, h.speaker_id)
                                }}
                            >
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: h.color }} />
                                {h.etiqueta.replace(/:$/, '')}
                            </button>
                        ))}
                        <button
                            className="ml-1 px-1.5 py-0.5 text-[10px] rounded hover:brightness-110"
                            style={{ color: 'var(--text-muted)' }}
                            onMouseDown={(e) => {
                                e.preventDefault()
                                setSelectionToolbar({ isActive: false, segmentIds: [], pos: { x: 0, y: 0 } })
                                window.getSelection()?.removeAllRanges()
                            }}
                        >✕</button>
                    </div>
                )}

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
