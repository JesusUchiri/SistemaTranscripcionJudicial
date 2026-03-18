import { Node, mergeAttributes } from '@tiptap/core'

export interface ProvisionalNodeOptions {
    HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        provisionalNode: {
            setProvisional: (attributes: { text: string; speakerId: string; color: string }) => ReturnType
            updateProvisional: (attributes: { text: string; speakerId: string; color: string }) => ReturnType
            removeProvisional: () => ReturnType
        }
    }
}

/**
 * ProvisionalNode — muestra texto de Deepgram no confirmado (is_final=false).
 *
 * Es un nodo INLINE para que las palabras provisionales fluyan dentro del mismo
 * párrafo que el último texto confirmado. Cuando se confirma (is_final=true),
 * el nodo se reemplaza con el span de segmento definitivo en la misma posición
 * → sin saltos de layout, sin pérdida del hilo visual.
 */
const ProvisionalNode = Node.create<ProvisionalNodeOptions>({
    name: 'provisionalNode',

    // INLINE: vive dentro de párrafos, no como bloque separado
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes() {
        return {
            text:      { default: '' },
            speakerId: { default: 'SPEAKER_00' },
            color:     { default: '#82868C' },
        }
    },

    parseHTML() {
        return [{ tag: 'span[data-provisional="true"]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(this.options.HTMLAttributes, {
                'data-provisional': 'true',
                class: 'text-provisional',
            }),
            HTMLAttributes.text || '',
        ]
    },

    /**
     * NodeView con innerHTML — permite que los <span class="provisional-word">
     * se rendericen como nodos DOM reales para la animación palabra-a-palabra.
     * El método update() actualiza innerHTML IN-PLACE sin destruir el DOM.
     */
    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('span')
            dom.setAttribute('data-provisional', 'true')
            dom.classList.add('text-provisional')

            const contentSpan = document.createElement('span')
            contentSpan.innerHTML = node.attrs.text || ''
            dom.appendChild(contentSpan)

            const cursor = document.createElement('span')
            cursor.classList.add('typing-cursor')
            dom.appendChild(cursor)

            return {
                dom,
                update(updatedNode) {
                    if (updatedNode.type.name !== 'provisionalNode') return false
                    // Solo reemplaza innerHTML — sin destruir/recrear el DOM
                    contentSpan.innerHTML = updatedNode.attrs.text || ''
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

            /**
             * Actualiza los attrs IN-PLACE con setNodeMarkup.
             * Dispara update() en el nodeView → solo innerHTML swap, sin recrear DOM.
             * Retorna false si no existe nodo provisional (usar setProvisional).
             */
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
