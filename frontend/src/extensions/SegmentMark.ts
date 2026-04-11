/**
 * SegmentMark — Mark TipTap para tracking de segmentos de transcripción.
 *
 * Características:
 * - Asocia texto con un segmento de la transcripción
 * - Trackea si fue editado por el usuario
 * - Almacena timestamp para click-to-play
 * - Visual indicator para segmentos editados
 */
import { Mark, mergeAttributes } from '@tiptap/core'

export interface SegmentMarkOptions {
    HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        segmentMark: {
            setSegment: (attributes: {
                segmentId: string
                timestamp: number
                editedByUser?: boolean
            }) => ReturnType
            markAsEdited: (segmentId: string) => ReturnType
            highlightActiveSegment: (segmentId: string) => ReturnType
        }
    }
}

const SegmentMark = Mark.create<SegmentMarkOptions>({
    name: 'segment',

    addOptions() {
        return {
            HTMLAttributes: {},
        }
    },

    addAttributes() {
        return {
            segmentId: {
                default: null,
                // Sin parseHTML por defecto TipTap busca 'segmentid' — necesitamos 'data-segment-id'
                parseHTML: element => element.getAttribute('data-segment-id'),
            },
            timestamp: {
                default: 0,
                parseHTML: element => parseFloat(element.getAttribute('data-timestamp') || '0'),
            },
            editedByUser: {
                default: false,
                parseHTML: element => element.getAttribute('data-edited') === 'true',
            },
            isActiveHighlight: {
                default: false,
                parseHTML: element => element.classList.contains('segment-active'),
            }
        }
    },

    parseHTML() {
        return [
            {
                tag: 'span[data-segment-id]',
            },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        const { segmentId, timestamp, editedByUser, isActiveHighlight } = HTMLAttributes
        const classes = ['segment-mark', 'segment-clickable']
        if (editedByUser) {
            classes.push('segment-edited')
        }
        if (isActiveHighlight) {
            classes.push('segment-active')
        }

        return [
            'span',
            mergeAttributes(this.options.HTMLAttributes, {
                class: classes.join(' '),
                'data-segment-id': segmentId,
                'data-timestamp': timestamp,
                'data-edited': editedByUser ? 'true' : 'false',
            }),
            0,
        ]
    },

    addCommands() {
        return {
            setSegment:
                (attributes) =>
                ({ commands }) => {
                    return commands.setMark(this.name, attributes)
                },
            markAsEdited:
                (segmentId) =>
                ({ tr, state }) => {
                    let found = false
                    state.doc.descendants((node, pos) => {
                        if (node.isText) {
                            const marks = node.marks
                            marks.forEach((mark) => {
                                if (
                                    mark.type.name === this.name &&
                                    mark.attrs.segmentId === segmentId &&
                                    mark.attrs.editedByUser !== true
                                ) {
                                    const newMark = mark.type.create({
                                        ...mark.attrs,
                                        editedByUser: true,
                                    })
                                    tr.removeMark(pos, pos + node.nodeSize, mark)
                                    tr.addMark(pos, pos + node.nodeSize, newMark)
                                    found = true
                                }
                            })
                        }
                    })
                    return found
                },
            highlightActiveSegment:
                (segmentId) =>
                ({ tr, state, dispatch }) => {
                    let modified = false
                    state.doc.descendants((node, pos) => {
                        if (node.isText) {
                            const marks = node.marks
                            marks.forEach((mark) => {
                                if (mark.type.name === this.name) {
                                    const isActive = mark.attrs.segmentId === segmentId
                                    const hasActiveClass = mark.attrs.HTMLAttributes?.class?.includes('segment-active')
                                    
                                    // Solo actualizar si el estado de highlight cambió
                                    if (isActive !== hasActiveClass) {
                                        const newMark = mark.type.create({
                                            ...mark.attrs,
                                            // TipTap no suele exponer classes dinámicas directo en attrs,
                                            // pero podemos forzarlas en renderHTML si las guardamos.
                                            // No obstante, la forma más limpia aquí es usar un atributo dedicado.
                                            isActiveHighlight: isActive
                                        })
                                        tr.removeMark(pos, pos + node.nodeSize, mark)
                                        tr.addMark(pos, pos + node.nodeSize, newMark)
                                        modified = true
                                    }
                                }
                            })
                        }
                    })
                    if (dispatch && modified) dispatch(tr)
                    return modified
                },
        }
    },
})

export default SegmentMark
