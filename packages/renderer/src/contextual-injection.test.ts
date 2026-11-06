// Contextual injection: the reproductions, and the model that closes them.
//
// Each case below rendered a live payload before this slice. They are kept as
// named reproductions rather than folded into the corpus because the corpus
// answers "does anything get through", and these answer "does this specific
// thing, which did get through, still". Those are different questions and the
// second one is the one a reviewer asks.
import { describe, expect, it } from 'vitest'
import { compileSection, upgradeCompiledSection, SANITIZER_POLICY_VERSION } from './compile.ts'
import { scanSlotSites, type SlotContext } from './context.ts'
import { CSS_POLICY_VERSION, scopeCss } from './css.ts'
import { renderSection, type ManifestSection } from './render.ts'
import type { SlotDef } from '@cms/schema'

const slot = (kind: SlotDef['kind'] = 'text'): SlotDef[] => [
  { id: 'value', kind, label: 'Value', constraints: {} } as SlotDef,
]

function render(template: string, value: unknown, kind: SlotDef['kind'] = 'text', preview = false): string {
  const slots = slot(kind)
  const compiled = compileSection({ sourceHtml: template, slots })
  const section = {
    def: {
      section_def_id: 'd',
      version: 1,
      slug: 'd',
      compiled_ast: compiled.ast,
      css: compiled.css,
      slots,
      render_hash: 'h',
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { label: 'S', hidden: false, hidden_at: [], values: { value } },
  } as unknown as ManifestSection
  return renderSection(section, 0, preview ? { preview: true } : {})
}

function compile(template: string, kind: SlotDef['kind'] = 'text') {
  return compileSection({ sourceHtml: template, slots: slot(kind) })
}

/** The context the compiler assigned to the single slot in a template. */
function contextOf(template: string): SlotContext {
  return scanSlotSites(template)[0]?.context ?? 'unknown'
}

describe('the four reported reproductions', () => {
  it('1. a slot in a bare attribute position cannot introduce an attribute', () => {
    // Was: <div onclick=alert(1)>x</div>
    const compiled = compile('<div {{value}}>x</div>')
    expect(contextOf('<div {{value}}>x</div>')).toBe('attribute-name')
    expect(compiled.blocking.join(' ')).toContain('attribute name')

    const html = render('<div {{value}}>x</div>', 'onclick=alert(1)')
    expect(html).not.toContain('onclick')
  })

  it('2. a slot in href goes through the URL policy', () => {
    // Was: <a href="javascript:alert(1)">go</a>
    expect(contextOf('<a href="{{value}}">go</a>')).toBe('url-attribute')
    const html = render('<a href="{{value}}">go</a>', 'javascript:alert(1)')
    expect(html).toContain('href="#"')
    expect(html).not.toContain('javascript:')
    // A legitimate URL is untouched, which is what makes this a policy and not
    // a blanket refusal.
    expect(render('<a href="{{value}}">go</a>', '/about')).toContain('href="/about"')
  })

  it('3. a slot in style goes through the CSS policy', () => {
    // Was: <div style="background:url(//evil.test/x)">x</div>
    expect(contextOf('<div style="{{value}}">x</div>')).toBe('style-attribute')
    const html = render('<div style="{{value}}">x</div>', 'background:url(//evil.test/x)')
    expect(html).not.toContain('evil.test')
    // And an ordinary declaration still works.
    expect(render('<div style="{{value}}">x</div>', 'color:red')).toContain('color:red')
    // A brace inside a quoted value does not end the declarations early.
    expect(render('<div style="{{value}}">x</div>', 'content:"}";color:red')).toContain('color:red')
    expect(render('<div style="{{value}}">x</div>', 'content:"{";color:blue')).toContain('color:blue')
  })

  it('4. an at-rule prelude containing markup is refused', () => {
    // Was: @media </style><script>alert(1)</script>{.a{color:red}}
    const result = scopeCss('@media </style><script>alert(1)</script>{.a{color:red}}', '.s')
    expect(result.css).toBe('')
    expect(result.violations.join(' ')).toContain('at-rule condition cannot contain markup')
    expect(result.blocking.length).toBeGreaterThan(0)
  })
})

describe('every structural position is classified, and the unsafe ones refused', () => {
  it.each([
    ['element text', '<div>{{value}}</div>', 'element-text'],
    ['quoted attribute', '<div title="{{value}}">x</div>', 'quoted-attribute'],
    ['single-quoted attribute', "<div title='{{value}}'>x</div>", 'quoted-attribute'],
    ['url attribute (href)', '<a href="{{value}}">x</a>', 'url-attribute'],
    ['url attribute (src)', '<img src="{{value}}" alt="">', 'url-attribute'],
    ['url attribute (action)', '<form action="{{value}}"></form>', 'url-attribute'],
    ['url attribute (formaction)', '<button formaction="{{value}}">x</button>', 'url-attribute'],
    ['url attribute (xlink:href)', '<svg><a xlink:href="{{value}}">x</a></svg>', 'url-attribute'],
    ['style attribute', '<div style="{{value}}">x</div>', 'style-attribute'],
    ['event handler', '<div onclick="{{value}}">x</div>', 'event-attribute'],
    ['srcdoc', '<iframe srcdoc="{{value}}"></iframe>', 'srcdoc-attribute'],
    ['unquoted attribute value', '<div title={{value}}>x</div>', 'unquoted-attribute'],
    ['attribute name', '<div {{value}}="x">y</div>', 'attribute-name'],
    ['between attributes', '<div id="a" {{value}} class="b">x</div>', 'attribute-name'],
    ['tag name', '<{{value}}>x</div>', 'tag-name'],
    ['end tag name', '<div>x</{{value}}>', 'tag-name'],
    ['comment', '<!-- {{value}} -->', 'comment'],
    ['raw text (script)', '<script>{{value}}</script>', 'raw-text'],
    ['raw text (style)', '<style>{{value}}</style>', 'raw-text'],
    ['raw text (title)', '<title>{{value}}</title>', 'raw-text'],
    ['raw text (textarea)', '<textarea>{{value}}</textarea>', 'raw-text'],
  ])('%s', (_label, template, expected) => {
    expect(contextOf(template)).toBe(expected)
  })

  it.each([
    ['event handler', '<div onclick="{{value}}">x</div>', 'alert(1)'],
    ['srcdoc', '<iframe srcdoc="{{value}}"></iframe>', '<script>alert(1)</script>'],
    ['unquoted attribute', '<div title={{value}}>x</div>', 'a onclick=alert(1)'],
    ['attribute name', '<div {{value}}="x">y</div>', 'onclick'],
    ['between attributes', '<div id="a" {{value}} class="b">x</div>', 'onclick=alert(1)'],
    ['tag name', '<{{value}}>x</div>', 'script'],
    ['comment', '<!-- {{value}} -->', '--><script>alert(1)</script><!--'],
    ['raw text', '<style>{{value}}</style>', '</style><script>alert(1)</script>'],
  ])('%s is blocking at compile time and renders nothing', (_label, template, payload) => {
    const compiled = compile(template)
    expect(compiled.blocking.length, `${template} was not blocking`).toBeGreaterThan(0)
    // Blocking problems appear in `problems` too, so a caller that only reads
    // one list still sees them.
    expect(compiled.problems.length).toBeGreaterThan(0)

    const html = render(template, payload)
    expect(html).not.toContain(payload)
    expect(html).not.toContain('alert(1)')
  })
})

describe('markup-emitting slots fail closed in every attribute context', () => {
  it.each([
    ['richtext', 'quoted', '<div title="{{value}}">x</div>'],
    ['richtext', 'url', '<a href="{{value}}">x</a>'],
    ['richtext', 'style', '<div style="{{value}}">x</div>'],
    ['link', 'quoted', '<div title="{{value}}">x</div>'],
    ['link', 'url', '<img src="{{value}}">'],
    ['image', 'quoted', '<div title="{{value}}">x</div>'],
    ['image', 'url', '<a href="{{value}}">x</a>'],
    ['button', 'quoted', '<div title="{{value}}">x</div>'],
  ] as const)('a %s slot in a %s attribute', (kind, _where, template) => {
    const compiled = compileSection({ sourceHtml: template, slots: slot(kind) })
    expect(compiled.blocking.join(' ')).toContain('markup cannot go')

    // The image case shipped a whole `<img>` element inside a quoted value,
    // closing it and starting a new attribute — attribute escaping alone never
    // saw it, because the value was assembled after escaping.
    // The whole section renders nothing, not merely the slot. A definition with
    // a blocking problem is not a page with a hole in it — it is a template
    // nobody has established the meaning of, and rendering the parts that
    // happen to be safe would put a half-built section in front of a reader
    // while the author believes it was refused.
    const html = render(template, { src: '/x.png', alt: 'a', url: '/u', label: 'L' }, kind)
    expect(html).toBe('')
  })
})

describe('the renderer fails closed on an AST it did not produce', () => {
  const legacyNode = (extra: Record<string, unknown> = {}) => ({
    nodes: [
      { kind: 'html', value: '<a href="' },
      { kind: 'slot', slotId: 'value', slotKind: 'text', ...extra },
      { kind: 'html', value: '">go</a>' },
    ],
    policyVersion: 1,
    cssPolicyVersion: 1,
  })

  function renderStored(ast: unknown, value: unknown): string {
    return renderSection(
      {
        def: {
          section_def_id: 'd',
          version: 1,
          slug: 'd',
          compiled_ast: ast,
          css: '',
          slots: slot(),
          render_hash: 'h',
          sanitizer_policy_version: 1,
          css_policy_version: CSS_POLICY_VERSION,
        },
        instance: { label: 'S', hidden: false, hidden_at: [], values: { value } },
      } as unknown as ManifestSection,
      0,
    )
  }

  it('re-classifies a version-1 AST from its own nodes rather than guessing', () => {
    const upgraded = upgradeCompiledSection(legacyNode())
    expect(upgraded.current).toBe(false)
    expect(upgraded.ast.policyVersion).toBe(SANITIZER_POLICY_VERSION)
    const slotNode = upgraded.ast.nodes.find(n => n.kind === 'slot')
    expect(slotNode && 'context' in slotNode && slotNode.context).toBe('url-attribute')
  })

  it('applies the URL policy to a version-1 AST, which version 1 did not', () => {
    expect(renderStored(legacyNode(), 'javascript:alert(1)')).not.toContain('javascript:')
  })

  it('leaves valid visible text from a version-1 AST unchanged', () => {
    // The bump must not be a silent rewrite of what readers see. A slot that
    // was in element text renders exactly as before.
    const ast = {
      nodes: [
        { kind: 'html', value: '<p>' },
        { kind: 'slot', slotId: 'value', slotKind: 'text' },
        { kind: 'html', value: '</p>' },
      ],
      policyVersion: 1,
      cssPolicyVersion: 1,
    }
    expect(renderStored(ast, 'Hello & goodbye')).toContain('<p>Hello &amp; goodbye</p>')
  })

  it('renders nothing for a version-1 AST whose slot turns out to be unsafe', () => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<div ' },
        { kind: 'slot', slotId: 'value', slotKind: 'text' },
        { kind: 'html', value: '>x</div>' },
      ],
      policyVersion: 1,
      cssPolicyVersion: 1,
    }
    expect(renderStored(ast, 'onclick=alert(1)')).toBe('')
  })

  it.each([
    ['null', null],
    ['a string', 'not an ast'],
    ['a number', 7],
    ['an array', []],
    ['no nodes', { policyVersion: 2 }],
    ['nodes that are not objects', { nodes: [1, 2, 3], policyVersion: 2 }],
    ['a slot with no id', { nodes: [{ kind: 'slot', slotKind: 'text' }], policyVersion: 2 }],
    ['an unknown node kind', { nodes: [{ kind: 'wat' }], policyVersion: 2 }],
  ])('refuses a corrupted AST: %s', (_label, ast) => {
    expect(renderStored(ast, 'x')).toBe('')
    expect(upgradeCompiledSection(ast).blocking.length).toBeGreaterThan(0)
  })

  it('refuses a hand-built AST that claims the current version but names a bad context', () => {
    // The context is data in a database row, so it is not evidence about
    // itself. A value claiming a context the renderer has no escaper for
    // renders nothing.
    const ast = {
      nodes: [
        { kind: 'html', value: '<div ' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'event-attribute' },
        { kind: 'html', value: '>x</div>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: 3,
    }
    expect(renderStored(ast, 'alert(1)')).not.toContain('alert(1)')
  })
})

describe('preview and public agree about attribute positions', () => {
  it('does not wrap an attribute-position slot in a span', () => {
    // A `<span>` inside a quoted value is not a node the editor can select — it
    // is a broken attribute, in preview only, which is the worst place for the
    // two paths to diverge.
    const html = render('<div title="{{value}}">x</div>', 'hello', 'text', true)
    expect(html).toContain('title="hello"')
    expect(html).not.toContain('title="<span')
  })

  it('still wraps an element-text slot in preview', () => {
    const html = render('<p>{{value}}</p>', 'hello', 'text', true)
    expect(html).toContain('data-cms-slot="value"')
  })

  it('renders identically in preview and public once instrumentation is removed', () => {
    const template = '<a href="{{value}}">go</a>'
    const preview = render(template, '/about', 'text', true)
    const live = render(template, '/about', 'text', false)
    expect(preview.replace(/ data-cms-[a-z]+="[^"]*"/g, '')).toBe(live)
  })
})

describe('CSS is treated as hostile input inside a raw-text element', () => {
  it.each([
    ['markup after a removed comment', '.a{color:red}</sty/**/le><script>alert(1)</script>'],
    ['a close tag in a selector', '</style><script>alert(1)</script>{color:red}'],
    ['a close tag in a declaration', '.a{background:</style><script>alert(1)</script>}'],
    ['a close tag in an at-rule prelude', '@media </style><script>x</script>{.a{color:red}}'],
  ])('%s never reaches the output', (_label, css) => {
    const result = scopeCss(css, '.s')
    expect(result.css).not.toContain('<')
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it.each([
    ['a legitimate comparison', '.a{content:"1 < 2"}'],
    ['a close tag hidden in a string', '.a{content:"</style><script>alert(1)</script>"}'],
  ])('escapes %s rather than refusing the whole rule', (_label, css) => {
    // Inside a string a `<` has a meaning worth keeping, and `\\3c` is that
    // meaning in a form the HTML tokenizer cannot read as a tag. Outside a
    // string there is nothing to preserve, so the declaration goes.
    const result = scopeCss(css, '.s')
    expect(result.css).not.toContain('<')
    expect(result.css).toContain('\\3c')
  })

  it.each([
    ['an unterminated string', '.a{content:"unterminated}'],
    ['an unterminated block', '.a{color:red'],
    ['an unterminated bracket', '.a{background:url(/x}'],
    ['an unterminated comment', '.a{color:red}/* nope'],
    ['a stray close brace', '}body{display:none}'],
  ])('%s fails closed rather than emitting a partial parse', (_label, css) => {
    const result = scopeCss(css, '.s')
    expect(result.css).toBe('')
    expect(result.blocking.length).toBeGreaterThan(0)
  })

  it('keeps a conditional at-rule and scopes its contents', () => {
    const result = scopeCss('@media (min-width:700px){.a{color:red}}', '.s')
    expect(result.css).toBe('@media (min-width:700px){.s .a{color:red}}')
  })

  it('reports an unsupported at-rule instead of dropping it in silence', () => {
    const result = scopeCss('@font-face{font-family:x;src:url(/f.woff)}', '.s')
    expect(result.css).toBe('')
    expect(result.violations.join(' ')).toContain('not supported')
  })
})
