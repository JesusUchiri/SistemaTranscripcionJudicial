'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

interface ActaEditorProps {
    initialContent: string
    onChange: (content: string) => void
    editable?: boolean
}

function ToolbarButton({
    onClick,
    active,
    disabled,
    title,
    children,
}: {
    onClick: () => void
    active?: boolean
    disabled?: boolean
    title: string
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onMouseDown={(e) => {
                e.preventDefault()
                onClick()
            }}
            disabled={disabled}
            title={title}
            className={`px-2.5 py-1 text-xs rounded transition-colors select-none font-medium ${
                active
                    ? 'bg-[var(--accent-gold)] text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
            {children}
        </button>
    )
}

export default function ActaEditor({
    initialContent,
    onChange,
    editable = true,
}: ActaEditorProps) {
    // La prop `key` en el componente padre controla cuándo se reinicializa el editor
    // (cuando se cambia de versión). No usamos useEffect para resetear el contenido
    // porque TipTap normaliza el HTML y la comparación siempre sería desigual.
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
        ],
        content: initialContent,
        immediatelyRender: false,
        editable,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML())
        },
        editorProps: {
            attributes: {
                class: 'prose prose-sm w-full mx-auto focus:outline-none bg-white p-8 sm:p-12 min-h-[800px] shadow-sm border border-[var(--border-subtle)] rounded outline-none',
            },
        },
    })

    if (!editor) {
        return (
            <div
                className="p-8 text-center text-sm"
                style={{ color: 'var(--text-muted)' }}
            >
                Cargando editor...
            </div>
        )
    }

    return (
        <div className="w-full flex flex-col items-center py-8 px-4">
            <div className="max-w-[850px] w-full">
                {editable && (
                    <div
                        className="flex flex-wrap items-center gap-1 mb-3 p-2 rounded shadow-sm sticky top-[57px] z-10"
                        style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-subtle)',
                        }}
                    >
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleBold().run()}
                            active={editor.isActive('bold')}
                            title="Negrita (Ctrl+B)"
                        >
                            Negrita
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                            active={editor.isActive('italic')}
                            title="Cursiva (Ctrl+I)"
                        >
                            Cursiva
                        </ToolbarButton>
                        <div className="w-px h-5 bg-gray-200 mx-0.5" />
                        <ToolbarButton
                            onClick={() =>
                                editor.chain().focus().toggleHeading({ level: 3 }).run()
                            }
                            active={editor.isActive('heading', { level: 3 })}
                            title="Título de sección"
                        >
                            Subtítulo
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().setParagraph().run()}
                            active={editor.isActive('paragraph')}
                            title="Párrafo normal"
                        >
                            Párrafo
                        </ToolbarButton>
                        <div className="w-px h-5 bg-gray-200 mx-0.5" />
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleBulletList().run()}
                            active={editor.isActive('bulletList')}
                            title="Lista con viñetas"
                        >
                            Lista
                        </ToolbarButton>
                        <div className="w-px h-5 bg-gray-200 mx-0.5" />
                        <ToolbarButton
                            onClick={() => editor.chain().focus().undo().run()}
                            disabled={!editor.can().undo()}
                            title="Deshacer (Ctrl+Z)"
                        >
                            Deshacer
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().redo().run()}
                            disabled={!editor.can().redo()}
                            title="Rehacer (Ctrl+Y)"
                        >
                            Rehacer
                        </ToolbarButton>
                        <span
                            className="ml-auto text-[10px] pr-1"
                            style={{ color: 'var(--text-muted)' }}
                        >
                            Ctrl+S para guardar
                        </span>
                    </div>
                )}
                <EditorContent editor={editor} />
            </div>
        </div>
    )
}
