import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
const captured = vi.hoisted(() => ({ options: null as any }))
vi.mock('@tiptap/react', async original => ({
  ...(await original<object>()),
  EditorContent: () => null,
  useEditor: (options: unknown) => {
    captured.options = options
    return null
  },
  useEditorState: () => null,
}))
import { richTextExtensions, visualValue } from './rich-text-model.ts'
import { RichTextField } from './rich-text-field.tsx'
describe('rich text history ownership', () => {
  it('enables editor undo for collection and frame fields by default', () => {
    renderToStaticMarkup(<RichTextField id="body" labelId="body-label" value="<p>Text</p>" onChange={() => {}} />)
    expect(captured.options.extensions[0].options.undoRedo).toEqual({})
  })
  it('leaves page-wide undo in control when explicitly requested by the inspector', () => {
    renderToStaticMarkup(
      <RichTextField id="body" labelId="body-label" value="<p>Text</p>" history="page" onChange={() => {}} />,
    )
    expect(captured.options.extensions[0].options.undoRedo).toBe(false)
  })
})

describe('shared rich-text language and disabled controls', () => {
  it('uses the same supported language on both surfaces and normalizes paste before parsing', () => {
    renderToStaticMarkup(<RichTextField id="body" labelId="body-label" value="<p>Text</p>" onChange={() => {}} />)
    expect(captured.options.extensions.map((entry: any) => entry.name)).toEqual(
      richTextExtensions('page').map(entry => entry.name),
    )
    expect(captured.options.extensions[0].options.heading.levels).toEqual([2, 3, 4])
    expect(captured.options.extensions[0].options.trailingNode).toBe(false)
    expect(
      captured.options.editorProps.transformPastedHTML(
        '<p onclick="bad()">Safe <strong>copy</strong><img src=x onerror=bad()><a href="javascript:bad()">link</a></p>',
      ),
    ).toBe('<p>Safe <strong>copy</strong><a href="#" rel="noopener nofollow">link</a></p>')
    expect(visualValue('<h1>Title</h1><p>Body &amp; detail</p>')).toBe('Title<p>Body &amp; detail</p>')
  })
  it('does not rewrite values on opening, and ignores updates when disabled', () => {
    const change = vi.fn()
    renderToStaticMarkup(
      <RichTextField id="body" labelId="body-label" value="<p>Keep <em>this</em>.</p>" disabled onChange={change} />,
    )
    expect(change).not.toHaveBeenCalled()
    expect(captured.options.editable).toBe(false)
    captured.options.onUpdate({ editor: { getHTML: () => '<p>Changed</p>' } })
    expect(change).not.toHaveBeenCalled()
  })
})

describe('an inline rich-text field', () => {
  // HNI's hero subtitle: words, a line break and red emphasis inside a paragraph.
  const constraints = { inline: true, inlineAttributes: { em: { class: 'text-sa-red' } } }
  it('edits a line of words and marks: no blocks, Enter breaks the line, and the source’s emphasis is drawn', () => {
    renderToStaticMarkup(
      <RichTextField
        id="sub"
        labelId="sub-label"
        value="Discover more<br><em>love</em>"
        history="page"
        constraints={constraints}
        onChange={() => {}}
      />,
    )
    const names = captured.options.extensions.map((entry: any) => entry.name)
    expect(names).toEqual(expect.arrayContaining(['starterKit', 'doc', 'cmsBreakOnEnter', 'link']))
    const kit = captured.options.extensions[0].options
    for (const block of ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'document'])
      expect(kit[block]).toBe(false)
    expect(kit.italic).toEqual({ HTMLAttributes: { class: 'text-sa-red' } })
    expect(captured.options.content).toBe('Discover more<br><em>love</em>')
    // A pasted paragraph cannot become a block inside the page's paragraph.
    expect(captured.options.editorProps.transformPastedHTML('<p>One</p><p>Two <em class="x">it</em></p>')).toBe(
      'One<br>Two <em>it</em>',
    )
  })
  it('stores canonical words and marks, never the drawn classes', () => {
    const change = vi.fn()
    renderToStaticMarkup(
      <RichTextField
        id="sub"
        labelId="sub-label"
        value=""
        history="page"
        constraints={constraints}
        onChange={change}
      />,
    )
    expect(captured.options.content).toBe('')
    captured.options.onUpdate({ editor: { getHTML: () => 'Discover<br><em class="text-sa-red">more</em>' } })
    expect(change).toHaveBeenCalledWith('Discover<br><em>more</em>')
  })
  it('opens a block field as before', () => {
    expect(visualValue('', false)).toBe('<p></p>')
    expect(visualValue('<p>One</p>', true)).toBe('One')
  })
})
