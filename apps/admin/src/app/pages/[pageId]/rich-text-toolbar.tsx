'use client'

import { useEffect, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { safeUrl } from '@cms/renderer/escape'
import {
  applyRichTextCommand,
  isRichTextCommand,
  richTextToolbarState,
  type RichTextCommand,
  type RichTextToolbarState,
} from './rich-text-commands.ts'

type ToolbarProps = { id: string; disabled?: boolean; label?: string; inline?: boolean }
/** Both visual surfaces operate on the same schema, controls and page history. */
export function RichTextToolbar({ editor, ...props }: ToolbarProps & { editor: Editor | null }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => (instance ? richTextToolbarState(instance) : null),
  })
  return (
    <RichTextToolbarView
      {...props}
      active={active}
      available={Boolean(editor)}
      onCommand={command => {
        if (editor && !props.disabled) applyRichTextCommand(editor, command, props.inline)
      }}
    />
  )
}
export function RichTextToolbarView({
  active,
  available,
  onCommand,
  id,
  disabled = false,
  label = 'Rich text formatting',
  inline = false,
}: ToolbarProps & {
  active: RichTextToolbarState | null
  available: boolean
  onCommand: (command: RichTextCommand) => void
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkHref, setLinkHref] = useState('')
  const [linkError, setLinkError] = useState('')
  const linkInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (linkOpen) linkInput.current?.focus()
  }, [linkOpen])
  useEffect(() => {
    if (disabled) {
      setLinkOpen(false)
      setLinkError('')
    }
  }, [disabled])

  const block = active?.h2 ? 'heading-2' : active?.h3 ? 'heading-3' : active?.h4 ? 'heading-4' : 'paragraph'

  function setBlock(next: string) {
    const command = { type: 'block', value: next }
    if (!disabled && available && isRichTextCommand(command)) onCommand(command)
  }

  function openLinkEditor() {
    if (!available || disabled) return
    if (active?.selectionEmpty && !active.link) {
      setLinkError('Select the words that should become a link first.')
      setLinkHref('')
    } else {
      setLinkError('')
      setLinkHref(active?.href ?? '')
    }
    setLinkOpen(true)
  }

  function applyLink() {
    if (!available || disabled) return
    const authored = linkHref.trim()
    if (authored === '') {
      onCommand({ type: 'unlink' })
      setLinkOpen(false)
      setLinkError('')
      return
    }
    if (active?.selectionEmpty && !active.link) {
      setLinkError('Select the words that should become a link first.')
      return
    }
    const href = safeUrl(authored)
    if (href === '#' && authored !== '#') {
      setLinkError('Enter a safe site path, web address, email address or phone number.')
      return
    }
    onCommand({ type: 'link', href })
    setLinkOpen(false)
    setLinkError('')
  }

  return (
    <>
      <div className="rich-editor-toolbar" role="toolbar" aria-label={label}>
        {!inline && (
          <>
            <label className="sr-only" htmlFor={`${id}-block`}>
              Text style
            </label>
            <select
              id={`${id}-block`}
              aria-label="Text style"
              value={block}
              disabled={disabled || !available}
              onChange={event => setBlock(event.target.value)}
            >
              <option value="paragraph">Paragraph</option>
              <option value="heading-2">Heading 2</option>
              <option value="heading-3">Heading 3</option>
              <option value="heading-4">Heading 4</option>
            </select>
            <span className="rich-editor-rule" aria-hidden="true" />
          </>
        )}
        <FormatButton
          label="Bold"
          pressed={active?.bold}
          disabled={disabled || !available}
          onClick={() => onCommand({ type: 'bold' })}
        >
          <strong>B</strong>
        </FormatButton>
        <FormatButton
          label="Italic"
          pressed={active?.italic}
          disabled={disabled || !available}
          onClick={() => onCommand({ type: 'italic' })}
        >
          <em>I</em>
        </FormatButton>
        {!inline && (
          <>
            <FormatButton
              label="Bulleted list"
              pressed={active?.bullet}
              disabled={disabled || !available}
              onClick={() => onCommand({ type: 'bullet' })}
            >
              • List
            </FormatButton>
            <FormatButton
              label="Numbered list"
              pressed={active?.ordered}
              disabled={disabled || !available}
              onClick={() => onCommand({ type: 'ordered' })}
            >
              1. List
            </FormatButton>
            <FormatButton
              label="Block quote"
              pressed={active?.quote}
              disabled={disabled || !available}
              onClick={() => onCommand({ type: 'quote' })}
            >
              “ Quote
            </FormatButton>
          </>
        )}
        <span className="rich-editor-rule" aria-hidden="true" />
        <FormatButton
          label="Add or edit link"
          pressed={active?.link}
          disabled={disabled || !available}
          onClick={openLinkEditor}
        >
          Link
        </FormatButton>
        <button
          type="button"
          aria-label="Remove link"
          disabled={disabled || !available || !active?.link}
          onClick={() => onCommand({ type: 'unlink' })}
        >
          Unlink
        </button>
      </div>

      {linkOpen && !disabled && (
        <div className="rich-editor-link" role="group" aria-label="Link destination">
          <label htmlFor={`${id}-href`}>Where the link goes</label>
          <input
            ref={linkInput}
            id={`${id}-href`}
            type="text"
            value={linkHref}
            placeholder="/about or https://example.org"
            onChange={event => {
              setLinkHref(event.target.value)
              setLinkError('')
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applyLink()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setLinkOpen(false)
                setLinkError('')
              }
            }}
          />
          <span className="btn-row">
            <button type="button" className="small" onClick={applyLink}>
              Apply
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                setLinkOpen(false)
                setLinkError('')
              }}
            >
              Cancel
            </button>
          </span>
          {linkError && (
            <p className="error-inline" role="alert">
              {linkError}
            </p>
          )}
        </div>
      )}
    </>
  )
}

function FormatButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string
  pressed: boolean | undefined
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={Boolean(pressed)}
      disabled={disabled}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
