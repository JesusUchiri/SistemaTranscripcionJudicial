'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import Paragraph from '@tiptap/extension-paragraph'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import { useEffect } from 'react'

interface ActaEditorProps {
    initialContent: string
    onChange: (content: string) => void
    editable?: boolean
}

export default function ActaEditor({ initialContent, onChange, editable = true }: ActaEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit,
            Document,
            Paragraph,
            Text,
            Heading.configure({ levels: [1, 2, 3] }),
        ],
        content: initialContent,
        editable,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML())
        },
        editorProps: {
            attributes: {
                class: 'prose prose-sm w-full mx-auto focus:outline-none bg-white p-8 sm:p-12 min-h-[800px] shadow border border-[var(--border-subtle)] outline-none rounded',
            },
        },
    })

    useEffect(() => {
        if (editor && initialContent !== editor.getHTML()) {
            // Update silently to prevent overriding if user is typing
            if (!editor.isFocused) {
                editor.commands.setContent(initialContent)
            }
        }
    }, [initialContent, editor])

    if (!editor) {
        return <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Cargando Editor de Acta Oficial...</div>
    }

    return (
        <div className="w-full flex flex-col items-center py-8">
            <div className="max-w-[850px] w-full">
                {/* Herramientas de formato básico (Opcional, en Sprint 9 lo hacemos libre con atajos) */}
                <EditorContent editor={editor} />
            </div>
        </div>
    )
}
