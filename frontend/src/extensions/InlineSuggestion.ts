/**
 * InlineSuggestion Extension para TipTap — Modo Reemplazo 1:1
 *
 * Sprint 6: Reconvertido de "ghost text de continuación" a "sugerencia de
 * reemplazo para la palabra bajo el cursor".
 *
 * Funcionalidades:
 * - Detecta la palabra bajo el cursor
 * - Consulta al backend por sugerencia de reemplazo
 * - Muestra la sugerencia como tooltip inline
 * - Aceptar reemplazo con Tab
 * - Cancelar con Escape
 * - NO inserta texto nuevo ni completa frases
 */
import { Extension, Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface InlineSuggestionOptions {
    /**
     * Función que obtiene la sugerencia de REEMPLAZO para una palabra
     * @param word - Palabra bajo el cursor
     * @param context - Contexto (frase completa)
     * @returns Promise con la palabra sugerida o null
     */
    fetchReplacement: (word: string, context: string) => Promise<string | null>

    /**
     * Tiempo de espera después de posicionar el cursor antes de buscar sugerencia (ms)
     */
    debounceMs?: number

    /**
     * Mínimo de caracteres de la palabra para buscar sugerencias
     */
    minWordLength?: number

    /**
     * Clase CSS para la sugerencia de reemplazo
     */
    suggestionClass?: string
}

export interface InlineSuggestionStorage {
    suggestion: string | null
    originalWord: string | null
    wordStart: number | null
    wordEnd: number | null
    isLoading: boolean
    debounceTimer: ReturnType<typeof setTimeout> | null
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        inlineSuggestion: {
            /**
             * Acepta la sugerencia de reemplazo (reemplaza la palabra)
             */
            acceptSuggestion: () => ReturnType
            /**
             * Rechaza/oculta la sugerencia actual
             */
            dismissSuggestion: () => ReturnType
        }
    }
}

const SUGGESTION_PLUGIN_KEY = new PluginKey('inlineSuggestion')

/**
 * Obtiene la palabra bajo el cursor y su rango
 */
function getWordAtCursor(editor: Editor): { word: string; from: number; to: number } | null {
    const { selection, doc } = editor.state
    const pos = selection.from

    if (!selection.empty) return null

    // Buscar inicio y fin de la palabra
    const textBefore = doc.textBetween(Math.max(0, pos - 50), pos, ' ')
    const textAfter = doc.textBetween(pos, Math.min(doc.content.size, pos + 50), ' ')

    const wordBeforeMatch = textBefore.match(/(\S+)$/)
    const wordAfterMatch = textAfter.match(/^(\S*)/)

    if (!wordBeforeMatch) return null

    const beforePart = wordBeforeMatch[1]
    const afterPart = wordAfterMatch ? wordAfterMatch[1] : ''
    const fullWord = beforePart + afterPart

    // Limpiar puntuación
    const cleanWord = fullWord.replace(/[.,;:!?¿¡"'()[\]{}]/g, '')
    if (!cleanWord || cleanWord.length < 2) return null

    const from = pos - beforePart.length
    const to = pos + afterPart.length

    return { word: cleanWord, from, to }
}

/**
 * Obtiene el contexto (frase) alrededor del cursor
 */
function getContextAtCursor(editor: Editor): string {
    const { selection, doc } = editor.state
    const pos = selection.from

    // Obtener ~200 caracteres alrededor del cursor
    const start = Math.max(0, pos - 100)
    const end = Math.min(doc.content.size, pos + 100)

    return doc.textBetween(start, end, ' ')
}

/**
 * Dispara la búsqueda de sugerencia de reemplazo
 */
function triggerReplacementFetch(
    editor: Editor,
    options: InlineSuggestionOptions,
    storage: InlineSuggestionStorage
): void {
    const wordInfo = getWordAtCursor(editor)
    if (!wordInfo) return

    const { word, from, to } = wordInfo
    if (word.length < (options.minWordLength || 3)) return

    if (storage.isLoading) return

    const context = getContextAtCursor(editor)

    storage.isLoading = true
    storage.originalWord = word
    storage.wordStart = from
    storage.wordEnd = to

    options
        .fetchReplacement(word, context)
        .then((replacement) => {
            // Solo mostrar si la sugerencia es diferente a la palabra original
            if (replacement && replacement.toLowerCase() !== word.toLowerCase()) {
                storage.suggestion = replacement
            } else {
                storage.suggestion = null
            }
            storage.isLoading = false
            // Forzar re-render
            editor.view.dispatch(editor.state.tr)
        })
        .catch(() => {
            storage.isLoading = false
            storage.suggestion = null
        })
}

export const InlineSuggestion = Extension.create<InlineSuggestionOptions, InlineSuggestionStorage>({
    name: 'inlineSuggestion',

    addOptions() {
        return {
            fetchReplacement: async () => null,
            debounceMs: 500,
            minWordLength: 3,
            suggestionClass: 'inline-suggestion-replacement',
        }
    },

    addStorage() {
        return {
            suggestion: null,
            originalWord: null,
            wordStart: null,
            wordEnd: null,
            isLoading: false,
            debounceTimer: null,
        }
    },

    addCommands() {
        return {
            acceptSuggestion:
                () =>
                    ({ editor, tr, dispatch }) => {
                        const { suggestion, wordStart, wordEnd } = this.storage
                        if (!suggestion || wordStart === null || wordEnd === null) return false

                        if (dispatch) {
                            // Reemplazar la palabra original por la sugerida (1:1)
                            tr.replaceWith(wordStart, wordEnd, editor.state.schema.text(suggestion))
                            this.storage.suggestion = null
                            this.storage.originalWord = null
                            this.storage.wordStart = null
                            this.storage.wordEnd = null
                        }
                        return true
                    },

            dismissSuggestion:
                () =>
                    () => {
                        if (this.storage.suggestion) {
                            this.storage.suggestion = null
                            this.storage.originalWord = null
                            this.storage.wordStart = null
                            this.storage.wordEnd = null
                            return true
                        }
                        return false
                    },
        }
    },

    addKeyboardShortcuts() {
        return {
            Tab: ({ editor }) => {
                if (this.storage.suggestion) {
                    editor.commands.acceptSuggestion()
                    return true
                }
                return false
            },
            Escape: ({ editor }) => {
                if (this.storage.suggestion) {
                    editor.commands.dismissSuggestion()
                    return true
                }
                return false
            },
        }
    },

    addProseMirrorPlugins() {
        const storage = this.storage
        const options = this.options
        const getEditor = () => this.editor

        return [
            new Plugin({
                key: SUGGESTION_PLUGIN_KEY,

                state: {
                    init() {
                        return DecorationSet.empty
                    },
                    apply(_tr, _oldState, _oldEditorState, newEditorState) {
                        const suggestion = storage.suggestion
                        const wordStart = storage.wordStart
                        const wordEnd = storage.wordEnd

                        if (!suggestion || wordStart === null || wordEnd === null) {
                            return DecorationSet.empty
                        }

                        // Verificar que el rango es válido
                        if (wordStart >= newEditorState.doc.content.size ||
                            wordEnd > newEditorState.doc.content.size) {
                            return DecorationSet.empty
                        }

                        // Crear decoración que muestra el reemplazo sugerido
                        // como tooltip encima de la palabra
                        const widget = Decoration.widget(
                            wordEnd,
                            () => {
                                const span = document.createElement('span')
                                span.className = options.suggestionClass || 'inline-suggestion-replacement'
                                span.textContent = ` → ${suggestion}`
                                span.setAttribute('data-suggestion', 'true')
                                span.setAttribute('data-original', storage.originalWord || '')
                                span.title = `Tab para aceptar "${suggestion}", Esc para descartar`
                                return span
                            },
                            { side: 1 }
                        )

                        // Resaltar la palabra original
                        const highlight = Decoration.inline(wordStart, wordEnd, {
                            class: 'inline-suggestion-target',
                        })

                        return DecorationSet.create(newEditorState.doc, [highlight, widget])
                    },
                },

                props: {
                    decorations(state) {
                        return this.getState(state)
                    },
                },

                view: () => ({
                    update: (view, prevState) => {
                        // Solo buscar sugerencia si la selección cambió (cursor se movió)
                        if (view.state.selection.eq(prevState.selection)) {
                            return
                        }

                        // Limpiar sugerencia anterior al moverse
                        storage.suggestion = null
                        storage.originalWord = null
                        storage.wordStart = null
                        storage.wordEnd = null

                        // Debounce para nueva sugerencia
                        if (storage.debounceTimer) {
                            clearTimeout(storage.debounceTimer)
                        }

                        storage.debounceTimer = setTimeout(() => {
                            const currentEditor = getEditor()
                            if (currentEditor) {
                                triggerReplacementFetch(
                                    currentEditor,
                                    options,
                                    storage
                                )
                            }
                        }, options.debounceMs)
                    },
                }),
            }),
        ]
    },
})

export default InlineSuggestion
