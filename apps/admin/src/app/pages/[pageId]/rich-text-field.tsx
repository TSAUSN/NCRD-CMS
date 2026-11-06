'use client'

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { editorValue, richTextExtensions, richTextPresentation, visualValue } from './rich-text-model.ts'
import { RichTextToolbar } from './rich-text-toolbar.tsx'

type Props = {
  id: string
  labelId: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Page editor owns cross-field undo; standalone workspaces use local history. */
  sourceMode?: boolean
  history?: 'field' | 'page'
  /** The field's definition constraints: an inline field holds words and
   * marks only, and the definition may fix its blocks' and marks' look. */
  constraints?: unknown
}

/**
 * A visual authoring surface for exactly the rich-text language the renderer
 * accepts. TipTap improves how a person writes it; `sanitizeRichText` remains
 * the security boundary and the only authority on what the page can emit.
 */
export function RichTextField({
  id,
  labelId,
  value,
  onChange,
  disabled = false,
  history = 'field',
  constraints,
  sourceMode = true,
}: Props) {
  const [mode, setMode] = useState<'visual' | 'source'>('visual')
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  // Fixed for the editor's lifetime: a field's definition does not change
  // while it is open, and TipTap's schema cannot change in place.
  const [presentation] = useState(() => richTextPresentation(constraints))
  const inline = presentation.inline

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: visualValue(value, inline),
    extensions: richTextExtensions(history, presentation),
    editorProps: {
      transformPastedHTML: html => editorValue(html, inline),
      attributes: {
        id,
        class: 'rich-editor-content',
        role: 'textbox',
        'aria-labelledby': labelId,
        'aria-multiline': 'true',
        'aria-readonly': String(disabled),
        'aria-disabled': String(disabled),
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (!disabledRef.current) onChange(editorValue(instance.getHTML(), inline))
    },
  })

  useEffect(() => {
    editor?.setEditable(!disabled, false)
  }, [editor, disabled])

  // Undo, per-field revert and section revert all arrive as prop changes. They
  // replace the document without creating a second page-history step.
  useEffect(() => {
    if (!editor) return
    const next = visualValue(value, inline)
    // Compared canonically: the editor draws the definition's classes on its
    // blocks and marks, which the stored value never holds.
    if (editorValue(editor.getHTML(), inline) !== editorValue(next, inline))
      editor.commands.setContent(next, { emitUpdate: false })
  }, [editor, value, inline])

  return (
    <div className="rich-editor" data-testid={`rich-editor-${id}`}>
      {sourceMode && (
        <div className="rich-editor-modes" role="group" aria-label="Rich text editing mode">
          <button
            type="button"
            className={mode === 'visual' ? 'on' : ''}
            aria-pressed={mode === 'visual'}
            onClick={() => setMode('visual')}
          >
            Visual
          </button>
          <button
            type="button"
            className={mode === 'source' ? 'on' : ''}
            aria-pressed={mode === 'source'}
            onClick={() => setMode('source')}
          >
            HTML source
          </button>
        </div>
      )}

      <div hidden={mode !== 'visual'}>
        <RichTextToolbar editor={editor} id={id} disabled={disabled} inline={inline} />

        <EditorContent editor={editor} />
      </div>

      <div className="rich-editor-source" hidden={mode !== 'source'}>
        <label htmlFor={`${id}-source`}>HTML source</label>
        <textarea
          id={`${id}-source`}
          className="code"
          rows={8}
          value={value}
          spellCheck={false}
          disabled={disabled}
          onChange={event => {
            if (!disabled) onChange(event.target.value)
          }}
        />
        <p className="hint">
          Advanced view. Unsupported tags and unsafe link destinations are removed when the page is shown.
        </p>
      </div>

      <p className="rich-editor-help">
        {inline
          ? 'This text sits inside a line of the page: Enter starts a new line, and pasted content keeps only bold, italic and links.'
          : 'Use headings in order; the page title remains the only Heading 1. Pasted content is reduced to the formatting shown above.'}
      </p>
    </div>
  )
}
