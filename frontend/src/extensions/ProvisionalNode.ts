import { Node, mergeAttributes } from '@tiptap/core'

export interface ProvisionalNodeOptions {
    HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        provisionalNode: {
            setProvisional: (attributes: { words: string[]; prevCount: number; speakerId: string; color: string; speakerLabel?: string }) => ReturnType
            updateProvisional: (attributes: { words: string[]; prevCount: number; speakerId: string; color: string; speakerLabel?: string }) => ReturnType
            removeProvisional: () => ReturnType
        }
    }
}

/**
 * ProvisionalNode — muestra texto de Deepgram no confirmado (is_final=false).
 *
 * Recibe `words: string[]` + `prevCount: number` para hacer DOM-diff:
 * - Solo se AÑADEN nuevos spans (nuevas palabras) — nunca se destruyen los existentes.
 * - Palabras ya vistas (i < prevCount) se actualizan a --stable (sin animación).
 * - Esto elimina el parpadeo por recreación de DOM en cada actualización.
 */
const ProvisionalNode = Node.create<ProvisionalNodeOptions>({
    name: 'provisionalNode',

    // INLINE: vive dentro de párrafos, no como bloque separado
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes() {
        return {
            words:       { default: [] },
            prevCount:   { default: 0 },
            speakerId:   { default: 'SPEAKER_00' },
            color:       { default: '#82868C' },
            speakerLabel: { default: '' },
        }
    },

    parseHTML() {
        return [{ tag: 'span[data-provisional="true"]' }]
    },

    renderHTML({ HTMLAttributes }) {
        const words = (HTMLAttributes.words || []) as string[]
        return [
            'span',
            mergeAttributes(this.options.HTMLAttributes, {
                'data-provisional': 'true',
                class: 'text-provisional',
            }),
            words.join(' '),
        ]
    },

    /**
     * NodeView con DOM-diff — solo añade spans nuevos, nunca destruye los existentes.
     * Esto garantiza:
     * - Sin parpadeo al aparecer texto confirmado (sin innerHTML wipe).
     * - Las animaciones de palabras en curso no se interrumpen.
     * - Sin layout thrash por recreación masiva de DOM.
     */
    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('span')
            dom.setAttribute('data-provisional', 'true')
            dom.classList.add('text-provisional')

            // Speaker label — shown when provisional speaker differs from last confirmed speaker
            const labelEl = document.createElement('span')
            labelEl.className = 'provisional-speaker-label'
            labelEl.style.display = 'none'
            dom.appendChild(labelEl)

            // Spans de palabras vivos (mutamos este array en syncWords)
            const wordSpans: HTMLSpanElement[] = []

            const cursor = document.createElement('span')
            cursor.classList.add('typing-cursor')
            dom.appendChild(cursor)

            function syncLabel(speakerLabel: string, color: string) {
                if (speakerLabel) {
                    labelEl.textContent = speakerLabel
                    labelEl.style.color = color
                    labelEl.style.display = 'inline'
                } else {
                    labelEl.style.display = 'none'
                }
            }

            function syncWords(words: string[], prevCount: number) {
                // 1. Quitar cursor temporalmente
                if (cursor.parentNode === dom) dom.removeChild(cursor)

                // 2. Reducir si words encogió (reset de speaker / nueva frase)
                while (wordSpans.length > words.length) {
                    const last = wordSpans.pop()!
                    // Quitar text-node de espacio que precede a este span (si existe)
                    const prev = last.previousSibling
                    if (prev && prev.nodeType === 3 /* Node.TEXT_NODE */ && prev.textContent === ' ') {
                        dom.removeChild(prev)
                    }
                    dom.removeChild(last)
                }

                // 3. Actualizar clase de spans existentes a --stable si ya son prevCount
                for (let i = 0; i < wordSpans.length; i++) {
                    if (i < prevCount && wordSpans[i].className !== 'provisional-word--stable') {
                        wordSpans[i].className = 'provisional-word--stable'
                    }
                }

                // 4. Añadir nuevos spans (solo los que no existen aún)
                for (let i = wordSpans.length; i < words.length; i++) {
                    // Espacio antes de cada palabra (excepto la primera)
                    if (i > 0) {
                        dom.appendChild(document.createTextNode(' '))
                    }
                    const span = document.createElement('span')
                    span.className = i < prevCount ? 'provisional-word--stable' : 'provisional-word'
                    span.textContent = words[i]
                    dom.appendChild(span)
                    wordSpans.push(span)
                }

                // 5. Re-añadir cursor al final
                dom.appendChild(cursor)
            }

            syncLabel(node.attrs.speakerLabel || '', node.attrs.color || '#82868C')
            syncWords(node.attrs.words || [], node.attrs.prevCount || 0)

            return {
                dom,
                update(updatedNode) {
                    if (updatedNode.type.name !== 'provisionalNode') return false
                    syncLabel(updatedNode.attrs.speakerLabel || '', updatedNode.attrs.color || '#82868C')
                    syncWords(updatedNode.attrs.words || [], updatedNode.attrs.prevCount || 0)
                    return true
                },
            }
        }
    },

    addCommands() {
        return {
            setProvisional:
                (attributes) =>
                    ({ commands }) =>
                        commands.insertContent({ type: this.name, attrs: attributes }),

            updateProvisional:
                (attributes) =>
                    ({ tr, state, dispatch }) => {
                        let foundPos = -1
                        state.doc.descendants((node, pos) => {
                            if (node.type.name === this.name) foundPos = pos
                        })
                        if (foundPos === -1) return false
                        tr.setNodeMarkup(foundPos, undefined, attributes)
                        if (dispatch) dispatch(tr)
                        return true
                    },

            removeProvisional:
                () =>
                    ({ tr, state, dispatch }) => {
                        let foundPos = -1
                        state.doc.descendants((node, pos) => {
                            if (node.type.name === this.name) foundPos = pos
                        })
                        if (foundPos === -1) return false
                        tr.delete(foundPos, foundPos + 1)
                        if (dispatch) dispatch(tr)
                        return true
                    },
        }
    },
})

export default ProvisionalNode
