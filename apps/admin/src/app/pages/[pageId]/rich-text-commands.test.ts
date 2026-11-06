import { expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { applyRichTextCommand, isRichTextCommand, isRichTextToolbarState } from './rich-text-commands.ts'
it('refuses arbitrary commands, unsafe URLs and extra payload before invoking an editor', () => {
  const chain = vi.fn(),
    editor = { isDestroyed: false, isEditable: true, chain } as unknown as Editor
  for (const command of [
    null,
    { type: 'eval', value: 'bad()' },
    { type: 'link', href: 'javascript:bad()' },
    { type: 'bold', html: '<script>' },
    { type: 'block', value: 'heading-1' },
  ]) {
    expect(isRichTextCommand(command)).toBe(false)
    expect(applyRichTextCommand(editor, command)).toBe(false)
  }
  for (const command of [
    { type: 'block', value: 'paragraph' },
    { type: 'bullet' },
    { type: 'ordered' },
    { type: 'quote' },
  ])
    expect(applyRichTextCommand(editor, command, true)).toBe(false)
  expect(chain).not.toHaveBeenCalled()
  expect(isRichTextCommand({ type: 'link', href: '/about' })).toBe(true)
})
it('refuses destroyed/read-only editors and malformed formatting state', () => {
  const chain = vi.fn()
  for (const editor of [
    { isDestroyed: true, isEditable: true, chain },
    { isDestroyed: false, isEditable: false, chain },
  ])
    expect(applyRichTextCommand(editor as unknown as Editor, { type: 'bold' })).toBe(false)
  expect(chain).not.toHaveBeenCalled()
  expect(isRichTextToolbarState({ bold: true })).toBe(false)
  expect(isRichTextToolbarState(null)).toBe(false)
})
