/**
 * SpeakerNode — Nodo TipTap para etiquetas de hablante.
 *
 * Características:
 * - No editable (el usuario no puede modificar la etiqueta directamente)
 * - Colores por hablante
 * - Muestra rol/nombre del hablante
 */
import { Node, mergeAttributes } from '@tiptap/core'

export interface SpeakerNodeOptions {
    HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        speakerNode: {
            setSpeaker: (attributes: { speakerId: string; label: string; color: string; rol?: string | null; firstSegmentId?: string | null }) => ReturnType
        }
    }
}

// Icono unicode y etiqueta de rol para distinguir visualmente al hablante en el canvas.
// Los valores se alinean con el ENUM del backend (`hablante.rol`).
const ROL_BADGE: Record<string, { icon: string; label: string }> = {
    juez: { icon: '⚖', label: 'JUEZ' },
    fiscal: { icon: '⚖', label: 'FISCAL' },
    abogado: { icon: '§', label: 'ABOGADO' },
    imputado: { icon: '◆', label: 'IMPUTADO' },
    agraviado: { icon: '◇', label: 'AGRAVIADO' },
    testigo: { icon: '✦', label: 'TESTIGO' },
    perito: { icon: '✶', label: 'PERITO' },
    secretario: { icon: '☰', label: 'SECRETARIO' },
    otro: { icon: '○', label: '' },
}

function rolBadge(rol: string | null | undefined): { icon: string; label: string } {
    if (!rol) return { icon: '○', label: '' }
    return ROL_BADGE[rol.toLowerCase()] || { icon: '○', label: rol.toUpperCase() }
}

const SpeakerNode = Node.create<SpeakerNodeOptions>({
    name: 'speakerNode',

    group: 'block',

    atom: true, // No editable

    addOptions() {
        return {
            HTMLAttributes: {},
        }
    },

    addAttributes() {
        return {
            speakerId: {
                default: null,
                parseHTML: element => element.getAttribute('speakerId') || element.getAttribute('data-speaker-id'),
            },
            label: {
                default: 'Speaker',
                parseHTML: element => element.getAttribute('label'),
            },
            color: {
                default: '#2563EB',
                parseHTML: element => element.getAttribute('color'),
            },
            rol: {
                default: null,
                parseHTML: element => element.getAttribute('data-rol'),
            },
            firstSegmentId: {
                default: null,
                parseHTML: element => element.getAttribute('data-first-segment-id'),
            },
        }
    },

    parseHTML() {
        return [
            {
                tag: 'speaker-label',
            },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        const { speakerId, label, color, rol, firstSegmentId } = HTMLAttributes
        const badge = rolBadge(rol as string | null | undefined)
        // Prefijo visible: icono + (etiqueta de rol si no está ya incluida en el label)
        const labelStr = String(label || '')
        const rolUpper = badge.label
        const showRolPrefix = rolUpper && !labelStr.toUpperCase().includes(rolUpper)
        const display = showRolPrefix
            ? `${badge.icon}  ${rolUpper} · ${labelStr}`
            : `${badge.icon}  ${labelStr}`
        return [
            'speaker-label',
            mergeAttributes(this.options.HTMLAttributes, {
                class: 'speaker-label',
                'data-speaker-id': speakerId,
                'data-rol': rol || '',
                'data-first-segment-id': firstSegmentId,
                label: label,
                color: color,
                style: `
                    display: inline-flex;
                    align-items: center;
                    gap: 0.4rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    font-size: 0.75rem;
                    letter-spacing: 0.05em;
                    padding: 4px 12px;
                    border-radius: 4px;
                    margin-top: 1.5rem;
                    margin-bottom: 0.5rem;
                    color: ${color};
                    background: ${color}14;
                    border-left: 4px solid ${color};
                    user-select: none;
                    cursor: pointer;
                    width: fit-content;
                `,
            }),
            display,
        ]
    },

    addCommands() {
        return {
            setSpeaker:
                (attributes) =>
                ({ commands }) => {
                    return commands.insertContent({
                        type: this.name,
                        attrs: attributes,
                    })
                },
        }
    },
})

export default SpeakerNode
