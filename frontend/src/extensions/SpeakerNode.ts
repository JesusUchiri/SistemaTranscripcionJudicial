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
            setSpeaker: (attributes: { speakerId: string; label: string; color: string }) => ReturnType
        }
    }
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
        const { speakerId, label, color, firstSegmentId } = HTMLAttributes
        return [
            'speaker-label',
            mergeAttributes(this.options.HTMLAttributes, {
                class: 'speaker-label',
                'data-speaker-id': speakerId,
                'data-first-segment-id': firstSegmentId,
                label: label,
                color: color,
                style: `
                    display: block;
                    font-weight: 700;
                    text-transform: uppercase;
                    font-size: 0.75rem;
                    letter-spacing: 0.05em;
                    padding: 4px 10px;
                    border-radius: 4px;
                    margin-top: 1.5rem;
                    margin-bottom: 0.5rem;
                    color: ${color};
                    background: ${color}12;
                    border-left: 3px solid ${color};
                    user-select: none;
                    cursor: pointer;
                    width: fit-content;
                `,
            }),
            label,
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
