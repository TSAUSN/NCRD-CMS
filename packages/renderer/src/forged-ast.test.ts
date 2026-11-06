import { CSS_POLICY_VERSION } from './css.ts'
// A stored AST is data, not evidence about itself.
//
// Policy 2 recorded each slot's context and then trusted it. A row is a row: a
// migration, a restore, a hand edit or a compromised authoring path can write
// `context: 'element-text'` onto a slot that sits in `<div {{value}}>`, and the
// renderer would then escape it as text — which is to say leave the quotes and
// the spaces alone — and emit whatever attribute the value asked for.
//
// So the structure is rebound on every render, from the node list itself. These
// hold that in place.
import { describe, expect, it } from 'vitest'
import { bindContexts, upgradeCompiledSection, SANITIZER_POLICY_VERSION } from './compile.ts'
import { KNOWN_CONTEXTS, scanSlotSites } from './context.ts'
import { renderSection, type ManifestSection } from './render.ts'

function renderStored(ast: unknown, value: unknown, kind = 'text'): string {
  return renderSection(
    {
      def: {
        section_def_id: 'd',
        version: 1,
        slug: 'd',
        compiled_ast: ast,
        css: '',
        slots: [{ id: 'value', kind, label: 'V', constraints: {} }],
        render_hash: 'h',
        sanitizer_policy_version: SANITIZER_POLICY_VERSION,
        css_policy_version: CSS_POLICY_VERSION,
      },
      instance: { label: 'S', hidden: false, hidden_at: [], values: { value } },
    } as unknown as ManifestSection,
    0,
  )
}

/** An AST that claims `element-text` wherever the html around it actually puts it. */
function forged(before: string, after: string, kind = 'text') {
  return {
    nodes: [
      { kind: 'html', value: before },
      { kind: 'slot', slotId: 'value', slotKind: kind, context: 'element-text' },
      { kind: 'html', value: after },
    ],
    policyVersion: SANITIZER_POLICY_VERSION,
    cssPolicyVersion: 4,
  }
}

describe('the reported reproduction', () => {
  it('a current-policy AST claiming element-text in a bare attribute position', () => {
    // Was: <div onclick=alert(1)>x</div>, with upgradeCompiledSection reporting
    // current: true and no blocking problems at all.
    const ast = forged('<div ', '>x</div>')
    const upgraded = upgradeCompiledSection(ast)

    expect(upgraded.blocking.join(' ')).toContain('claims to sit in element-text but sits in attribute-name')
    expect(upgraded.current).toBe(false)
    expect(renderStored(ast, 'onclick=alert(1)')).toBe('')
  })
})

describe('a forged safe context is caught in every position', () => {
  it.each([
    ['tag name', '<', '>x</div>'],
    ['attribute name', '<div ', '>x</div>'],
    ['unquoted value', '<div title=', '>x</div>'],
    ['url attribute', '<a href="', '">go</a>'],
    ['style attribute', '<div style="', '">x</div>'],
    ['event handler', '<div onclick="', '">x</div>'],
    ['srcdoc', '<iframe srcdoc="', '"></iframe>'],
    ['comment', '<!-- ', ' -->'],
    ['raw text', '<script>', '</script>'],
  ])('%s', (_label, before, after) => {
    const ast = forged(before, after)
    const bound = bindContexts(ast.nodes as never)
    expect(bound.blocking.join(' '), `${before}…${after}`).toContain('claims to sit in element-text')
    expect(renderStored(ast, 'onclick=alert(1)')).toBe('')
  })

  it('is caught for a quoted attribute too, where the escaper differs', () => {
    // Not an injection on its own — but element-text escaping leaves quotes
    // alone, and this value closes the attribute.
    const ast = forged('<div title="', '">x</div>')
    expect(bindContexts(ast.nodes as never).blocking.join(' ')).toContain('claims to sit in element-text')
    expect(renderStored(ast, 'x" onclick="alert(1)')).toBe('')
  })
})

describe('duplicate slot ids are bound by position, not by name', () => {
  const duplicate = {
    nodes: [
      { kind: 'html', value: '<p>' },
      { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
      { kind: 'html', value: '</p><div ' },
      { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
      { kind: 'html', value: '>x</div>' },
    ],
    policyVersion: SANITIZER_POLICY_VERSION,
    cssPolicyVersion: 4,
  }

  it('catches the unsafe occurrence even though a safe one shares its id', () => {
    // Keying the lookup by slotId let the two collapse into one entry, and
    // whichever survived decided for both. The safe one overwriting the unsafe
    // one is the wrong way round to be wrong.
    const bound = bindContexts(duplicate.nodes as never)
    expect(bound.blocking.join(' ')).toContain('attribute name')
    expect(renderStored(duplicate, 'onclick=alert(1)')).toBe('')
  })

  it('binds each occurrence to its own position', () => {
    const sites = scanSlotSites('<p>{{value}}</p><div {{value}}>x</div>')
    expect(sites.map(s => s.context)).toEqual(['element-text', 'attribute-name'])
  })
})

describe('a context string has to be a context', () => {
  it.each([
    ['a made-up name', 'totally-made-up'],
    ['an empty string', ''],
    ['a number', 7],
    ['an object', { context: 'element-text' }],
    ['null', null],
  ])('refuses %s', (_label, context) => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<div title="' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context },
        { kind: 'html', value: '">x</div>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: 4,
    }
    expect(renderStored(ast, 'x" onclick="alert(1)')).toBe('')
  })

  it('lists every context it knows, so the set is one thing and not three', () => {
    expect(KNOWN_CONTEXTS).toContain('element-text')
    expect(KNOWN_CONTEXTS).toContain('raw-text')
    expect(KNOWN_CONTEXTS).not.toContain('totally-made-up')
  })
})

describe('the declared attribute has to match too', () => {
  it('refuses a slot that claims a different attribute than it sits in', () => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<a href="' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'url-attribute', attribute: 'title' },
        { kind: 'html', value: '">go</a>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: 4,
    }
    expect(bindContexts(ast.nodes as never).blocking.join(' ')).toContain('claims the title attribute')
  })
})

describe('the node list has to describe the template it claims to', () => {
  it('refuses an html node smuggling a slot token into the reconstruction', () => {
    // Otherwise an extra `{{x}}` inside an html node introduces a site the
    // compiler never emitted, and every pairing after it shifts by one.
    const ast = {
      nodes: [
        { kind: 'html', value: '<p>{{value}}</p><div ' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
        { kind: 'html', value: '>x</div>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: 4,
    }
    expect(bindContexts(ast.nodes as never).blocking.join(' ')).toContain(
      'does not describe the template it was compiled from',
    )
    expect(renderStored(ast, 'onclick=alert(1)')).toBe('')
  })
})

describe('a legitimate AST still renders', () => {
  it('adopts the derived context and produces the same output as before', () => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<p>' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
        { kind: 'html', value: '</p>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: 4,
    }
    expect(upgradeCompiledSection(ast).blocking).toEqual([])
    expect(renderStored(ast, 'Hello & goodbye')).toContain('<p>Hello &amp; goodbye</p>')
  })

  it('re-derives a version-1 node that recorded nothing', () => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<a href="' },
        { kind: 'slot', slotId: 'value', slotKind: 'text' },
        { kind: 'html', value: '">go</a>' },
      ],
      policyVersion: 1,
      cssPolicyVersion: 1,
    }
    expect(upgradeCompiledSection(ast).blocking).toEqual([])
    expect(renderStored(ast, 'javascript:alert(1)')).toContain('href="#"')
  })
})
