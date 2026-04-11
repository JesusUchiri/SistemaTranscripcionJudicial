'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, Heading3, AlignLeft, List, Undo2, Redo2 } from 'lucide-react'

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
    icon: Icon,
}: {
    onClick: () => void
    active?: boolean
    disabled?: boolean
    title: string
    icon: any
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
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                active
                    ? 'bg-[#1B3A5C] text-white shadow-md'
                    : 'bg-transparent text-[#1B3A5C]/60 hover:bg-[#1B3A5C]/5 hover:text-[#1B3A5C]'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
        >
            <Icon className="w-4 h-4" />
        </button>
    )
}

export default function ActaEditor({
    initialContent,
    onChange,
    editable = true,
}: ActaEditorProps) {
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
                class: 'prose prose-sm max-w-none focus:outline-none min-h-[800px] outline-none text-[#1A1A1A]',
            },
        },
    })

    if (!editor) {
        return (
            <div className="p-8 text-center text-xs font-bold uppercase tracking-widest text-[#1B3A5C]/40 animate-pulse">
                Inicializando Editor Oficial...
            </div>
        )
    }

    return (
        <div className="w-full flex flex-col">
            {editable && (
                <div className="flex items-center gap-1 mb-8 p-1.5 rounded-xl bg-white border border-[#1B3A5C]/10 shadow-sm sticky top-[10px] z-10 w-max mx-auto">
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        active={editor.isActive('bold')}
                        title="Negrita (Ctrl+B)"
                        icon={Bold}
                    />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        active={editor.isActive('italic')}
                        title="Cursiva (Ctrl+I)"
                        icon={Italic}
                    />
                    <div className="w-px h-5 bg-[#1B3A5C]/10 mx-1" />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                        active={editor.isActive('heading', { level: 3 })}
                        title="Subtítulo"
                        icon={Heading3}
                    />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().setParagraph().run()}
                        active={editor.isActive('paragraph')}
                        title="Párrafo"
                        icon={AlignLeft}
                    />
                    <div className="w-px h-5 bg-[#1B3A5C]/10 mx-1" />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        active={editor.isActive('bulletList')}
                        title="Lista"
                        icon={List}
                    />
                    <div className="w-px h-5 bg-[#1B3A5C]/10 mx-1" />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().undo().run()}
                        disabled={!editor.can().undo()}
                        title="Deshacer"
                        icon={Undo2}
                    />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().redo().run()}
                        disabled={!editor.can().redo()}
                        title="Rehacer"
                        icon={Redo2}
                    />
                </div>
            )}
            <div className="text-[14px] leading-relaxed">
                <EditorContent editor={editor} />
            </div>
        </div>
    )
}
