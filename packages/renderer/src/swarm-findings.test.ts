// Defects an adversarial swarm found that the corpus did not.
//
// Each is a reproduction the auditors ran, kept as a regression because each
// was reachable at HEAD and none was caught by the existing suites.
import { describe, expect, it } from 'vitest'
import { SANITIZER_POLICY_VERSION, SCRIPT_AND_SLOTS, compileSection, upgradeCompiledSection } from './compile.ts'
import { URL_ATTRIBUTES, scanSlotSites } from './context.ts'
import { CSS_POLICY_VERSION, scopeCss, validateCompiledCss } from './css.ts'
import { URL_ATTRIBUTE_FORMS, safeUrl, safeUrlAttribute, urlAttributeForm } from './escape.ts'
import { sanitizeRichText } from './richtext.ts'
import { renderPage, renderSection, themeCss, type RenderManifest, type SiteShell } from './render.ts'
import { selectorIsScoped } from './selector.ts'

const SCOPE = '.cms-section--d'

describe('R-01 — theme font tokens are not a hole in the stylesheet', () => {
  it.each([
    ['a style breakout with meta refresh', 'a</style><meta http-equiv="refresh" content="0;url=//evil.test">'],
    ['a style breakout with a form', 'a</style><form action="//evil.test/collect">'],
    ['a base tag', 'a</style><base href="//evil.test/">'],
    ['an image with a handler', 'a</style><img src=q onerror="window.__x=1">'],
  ])('refuses %s', (_label, font) => {
    const css = themeCss({ fonts: { heading: font } })
    expect(css).not.toContain('<')
    expect(css).not.toContain('evil.test')
  })

  it('reaches the whole document, which is why it mattered', () => {
    const manifest = {
      page: { id: 'p', version_id: 'v', title: 'T', path: '/' },
      meta: {},
      sections: [],
    } as unknown as RenderManifest
    const shell = {
      site: { id: 's', name: 'S', slug: 's' },
      theme: { fonts: { heading: 'a</style><meta http-equiv="refresh" content="0;url=//evil.test">' } },
      navigation: [],
      canonical_host: 'good.test',
      staging_host: null,
    } as unknown as SiteShell
    const { html } = renderPage({ manifest, shell, isStaging: false })
    expect(html).not.toContain('http-equiv')
    expect(html).not.toContain('evil.test')
    // Exactly one <style>: the shell's own, still closed by its own end tag.
    expect((html.match(/<style/g) ?? []).length).toBe(1)
  })

  it.each([
    ['a device-native stack', "system-ui, -apple-system, 'Segoe UI', sans-serif"],
    ['a serif stack', "Georgia, 'Times New Roman', serif"],
    ['one family', 'system-ui'],
  ])('still accepts %s', (_label, font) => {
    expect(themeCss({ fonts: { body: font } })).toContain(`--font-body:${font}`)
  })

  it('still refuses a font URL, which was the only thing it used to refuse', () => {
    // Asserted on the *declaration*, not the name: the static rule below always
    // references `var(--font-body,…)`, so the name is present either way.
    expect(themeCss({ fonts: { body: 'https://fonts.example.com/x.css' } })).not.toContain('--font-body:')
  })
})

describe('R-02 — `</>` returns to data, as HTML says', () => {
  it('classifies a slot after it by where it really sits', () => {
    // `</>` is missing-end-tag-name: dropped, back to DATA. Treating it as a
    // bogus comment ran to the *next* `>` — one inside a quoted attribute —
    // so this slot was called element text and escaped for the wrong sink.
    const template = '</><div id=t title="{{value}}">hi</div>'
    expect(scanSlotSites(template)[0]?.context).toBe('quoted-attribute')
  })

  it('does not let a plain text value introduce attributes', () => {
    const template = '</><div id=t title="{{value}}">hi</div>'
    const compiled = compileSection({
      sourceHtml: template,
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.blocking).toEqual([])
    const node = compiled.ast.nodes.find(n => n.kind === 'slot')
    expect(node && 'context' in node && node.context).toBe('quoted-attribute')
  })

  it('R-03 — and no longer hides a script start tag from the scanner', () => {
    const compiled = compileSection({
      sourceHtml: '</><script>{{value}}</script>',
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.blocking.length).toBeGreaterThan(0)
  })
})

describe('R-07 — the rich-text tag pattern does not backtrack quadratically', () => {
  it('sanitizes a large value in linear time', () => {
    const big = `<p>${' '.repeat(100_000)}</p>`
    const started = performance.now()
    sanitizeRichText(big)
    const elapsed = performance.now() - started
    // Was ~4.4 s for this input. A generous ceiling: the point is the shape of
    // the curve, not a millisecond budget on someone else's machine.
    expect(elapsed).toBeLessThan(500)
  })

  it('accepts exactly what it accepted before', () => {
    expect(sanitizeRichText('<p>hi <strong>there</strong></p>')).toBe('<p>hi <strong>there</strong></p>')
    expect(sanitizeRichText('<a href="/x" title="t">go</a>')).toBe('<a href="/x" rel="noopener nofollow">go</a>')
    expect(sanitizeRichText('<img src=x onerror=alert(1)>')).toBe('')
  })
})

describe('CSS-02 — a selector’s subject has to stay inside the scope', () => {
  it.each([
    ['a general sibling', '.cms-section--d ~ *'],
    ['an adjacent sibling', '.cms-section--d + div'],
    ['a sibling after a descendant', '.cms-section--d ~ .anything'],
  ])('refuses %s, which selects outside the section', (_label, selector) => {
    // The subject of a selector is its LAST compound. Rooting the first one
    // confines the match only while every step descends; `~` and `+` step
    // sideways, so these select the section's siblings — the rest of the page.
    expect(selectorIsScoped(selector, SCOPE)).toBe(false)
    expect(validateCompiledCss(`${selector}{color:red}`, SCOPE)).not.toEqual([])
  })

  it.each([
    ['a descendant', '.cms-section--d .a'],
    ['a child', '.cms-section--d > .a'],
    ['the scope itself', '.cms-section--d'],
    ['a sibling inside the scope', '.cms-section--d .a ~ .b'],
    ['a compound', '.cms-section--d.big'],
  ])('still accepts %s', (_label, selector) => {
    expect(selectorIsScoped(selector, SCOPE), selector).toBe(true)
  })

  it('refuses the authored form too, not only the stored one', () => {
    expect(scopeCss('& ~ *{color:red}', SCOPE).css).toBe('')
  })
})

describe('R-04 — a script cannot hide inside foreign content', () => {
  const slots = [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never

  // Chromium runs every one of these. `<svg>` and `<math>` put the parser into
  // foreign content, where the raw-text elements are not raw text at all, so a
  // walk that treats `title` as raw text everywhere never sees the script.
  it.each([
    ['svg title', '<svg><title><script>window.__p=1</script></title></svg><p>{{value}}</p>'],
    ['svg textarea', '<svg><textarea><script>window.__p=1</script></textarea></svg><p>{{value}}</p>'],
    ['svg style', '<svg><style><script>window.__p=1</script></style></svg><p>{{value}}</p>'],
    ['svg desc', '<svg><desc><script>window.__p=1</script></desc></svg><p>{{value}}</p>'],
    ['svg xmp', '<svg><xmp><script>window.__p=1</script></xmp></svg><p>{{value}}</p>'],
    ['svg noembed', '<svg><noembed><script>window.__p=1</script></noembed></svg><p>{{value}}</p>'],
    ['math mtext', '<math><mtext><script>window.__p=1</script></mtext></math><p>{{value}}</p>'],
  ])('refuses a template whose %s conceals one', (_label, sourceHtml) => {
    const compiled = compileSection({ sourceHtml, slots })
    expect(compiled.blocking).toContain(SCRIPT_AND_SLOTS)
  })

  it('refuses a script the walk would have been inside raw text for', () => {
    // Inert in a browser, and refused anyway. The rule is about the template
    // carrying a script at all, and matching the database's reading of it
    // beats being cleverer than the gate that has the final say.
    const compiled = compileSection({
      sourceHtml: '<title>about <script></title><p>{{value}}</p>',
      slots,
    })
    expect(compiled.blocking).toContain(SCRIPT_AND_SLOTS)
  })

  it('still allows a script in a template that has no slots', () => {
    const compiled = compileSection({
      sourceHtml: '<svg><title><script>window.__p=1</script></title></svg>',
      slots: [] as never,
    })
    expect(compiled.blocking).toEqual([])
  })

  it('refuses a stored AST that hid one the same way', () => {
    const nodes = [
      { kind: 'html', value: '<svg><title><script>window.__p=1</script></title></svg><p>' },
      { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
      { kind: 'html', value: '</p>' },
    ]
    const upgraded = upgradeCompiledSection({
      nodes,
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: CSS_POLICY_VERSION,
    } as never)
    expect(upgraded.blocking).toContain(SCRIPT_AND_SLOTS)
  })
})

describe('R-09 — list-valued URL attributes are checked as lists', () => {
  it('no longer welds a srcset together', () => {
    expect(safeUrlAttribute('srcset', '/a.png 1x, /b.png 2x')).toBe('/a.png 1x, /b.png 2x')
  })

  it('keeps the spaces in a ping list', () => {
    expect(safeUrlAttribute('ping', '/a /b')).toBe('/a /b')
  })

  it.each([
    ['an off-site candidate behind a same-site one', 'srcset', '/a.png 1x, //evil.test/x.png 2x'],
    ['a javascript candidate', 'srcset', '/a.png 1x, javascript:alert(1) 2x'],
    ['an off-site ping', 'ping', '/a //evil.test/collect'],
    ['a descriptor that is not one', 'srcset', '/a.png 1x, /b.png 2x 3x'],
  ])('refuses the whole value for %s', (_label, attribute, value) => {
    expect(safeUrlAttribute(attribute, value)).toBe('')
  })

  it('renders the refusal as an empty attribute, not a broken one', () => {
    const compiled = compileSection({
      sourceHtml: '<img src="/a.png" srcset="{{value}}">',
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.blocking).toEqual([])
    const html = renderSection(
      {
        def: {
          section_def_id: 'd',
          version: 1,
          slug: 'd',
          compiled_ast: compiled.ast,
          css: compiled.css,
          slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }],
          render_hash: 'h',
          sanitizer_policy_version: SANITIZER_POLICY_VERSION,
          css_policy_version: CSS_POLICY_VERSION,
        },
        instance: { label: 'S', hidden: false, hidden_at: [], values: { value: '/a.png 1x, //evil.test/x.png 2x' } },
      } as never,
      0,
    )
    expect(html).not.toContain('evil.test')
  })

  it('leaves a single-URL attribute alone', () => {
    expect(safeUrlAttribute('href', 'https://example.test/a b')).toBe('https://example.test/a b')
    expect(safeUrlAttribute('href', 'java\nscript:alert(1)')).toBe('#')
    expect(safeUrlAttribute('href', '  //evil.test')).toBe('#')
  })
})

describe('R-03 — `</>` cannot hide a script from the script-and-slots rule', () => {
  it('refuses the template the auditor executed in Chromium', () => {
    // The reported reproduction: `</>` sent the scanner into a bogus comment,
    // which ran on past the `<script>` start tag, so the slot inside script
    // data was classified as element text and `escapeText` — which does not
    // touch a quote — let the value close the string it sat in.
    const compiled = compileSection({
      sourceHtml: '</><script>var a="{{value}}";</script>',
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.blocking).toContain(SCRIPT_AND_SLOTS)
  })

  it('and the scanner no longer misreads `</>` either', () => {
    // Both halves are fixed independently, which is the point: the rule holds
    // even where the walk is wrong, and the walk is no longer wrong here.
    expect(scanSlotSites('</><p title="{{value}}">')[0]?.context).toBe('quoted-attribute')
  })
})

describe('R-04 — foreign content, in every shape the auditor listed', () => {
  const slots = [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never
  const refuses = (sourceHtml: string) => compileSection({ sourceHtml, slots }).blocking.includes(SCRIPT_AND_SLOTS)

  it.each([
    ['svg title', '<svg><title><script>x()</script></title></svg>'],
    ['svg desc', '<svg><desc><script>x()</script></desc></svg>'],
    ['svg foreignObject', '<svg><foreignObject><script>x()</script></foreignObject></svg>'],
    ['nested svg', '<svg><g><svg><title><script>x()</script></title></svg></g></svg>'],
    ['mathml mtext', '<math><mtext><script>x()</script></mtext></math>'],
    ['mixed namespaces', '<math><mi><svg><title><script>x()</script></title></svg></mi></math>'],
    ['upper case svg', '<SVG><TITLE><SCRIPT>x()</SCRIPT></TITLE></SVG>'],
    ['mixed case script', '<svg><title><ScRiPt>x()</ScRiPt></title></svg>'],
    ['a malformed close', '<svg><title><script>x()</scriptx></title></svg>'],
    ['no close at all', '<svg><title><script>x()'],
    ['whitespace in the tag', '<svg><title>< script src="/x.js"></title></svg>'],
    ['a self-closing form', '<svg><title><script/></title></svg>'],
  ])('refuses a slot after a script concealed by %s', (_label, markup) => {
    expect(refuses(`${markup}<p>{{value}}</p>`)).toBe(true)
  })

  it.each([
    ['before', '<script>x()</script><p>{{value}}</p>'],
    ['after', '<p>{{value}}</p><script>x()</script>'],
    ['between two slots', '<p>{{value}}</p><script>x()</script><p>{{other}}</p>'],
  ])('refuses a script %s the slot as well', (_label, sourceHtml) => {
    const compiled = compileSection({
      sourceHtml,
      slots: [
        { id: 'value', kind: 'text', label: 'V', constraints: {} },
        { id: 'other', kind: 'text', label: 'O', constraints: {} },
      ] as never,
    })
    expect(compiled.blocking).toContain(SCRIPT_AND_SLOTS)
  })

  it('leaves a template with neither a script nor foreign trouble alone', () => {
    const compiled = compileSection({
      sourceHtml: '<svg><title>An icon</title><path d="M0 0"/></svg><p>{{value}}</p>',
      slots,
    })
    expect(compiled.blocking).toEqual([])
  })
})

describe('R-05 — a solidus separates attributes, so it separates handlers too', () => {
  it.each([
    ['a slash before the handler', '<img/onerror="x()" src=q>'],
    ['a slash on both sides', '<img/onerror/="x()" src=q>'],
    ['several slashes', '<img//onerror="x()" src=q>'],
    ['the ordinary spaced form', '<img onerror="x()" src=q>'],
  ])('marks %s as trusted code', (_label, sourceHtml) => {
    expect(compileSection({ sourceHtml, slots: [] }).carriesTrustedCode).toBe(true)
  })

  it('marks the other executable scheme too', () => {
    // The CSS policy has always refused vbscript:. This gate did not, so the
    // same scheme was active markup in a stylesheet and unremarkable in a
    // template — and static markup never passes through safeUrl.
    expect(compileSection({ sourceHtml: '<a href="vbscript:x()">go</a>', slots: [] }).carriesTrustedCode).toBe(true)
  })

  it('does not call ordinary markup active', () => {
    expect(compileSection({ sourceHtml: '<p class="one">text</p>', slots: [] }).carriesTrustedCode).toBe(false)
  })
})

describe('R-06 — a backslash is a slash in the authority position', () => {
  it.each([
    ['/\\evil.test/phish'],
    ['\\\\evil.test/phish'],
    ['\\/evil.test/phish'],
    ['/\\/evil.test/x'],
    ['  /\\evil.test/x'],
  ])('refuses %s', value => {
    expect(safeUrl(value)).toBe('#')
  })

  it('leaves a path that merely contains one alone', () => {
    expect(safeUrl('/a\\b.txt')).toBe('/a\\b.txt')
    expect(safeUrl('https://example.test/a\\b')).toBe('https://example.test/a\\b')
  })
})

describe('R-09 — every URL attribute is classified by what it holds', () => {
  it.each([
    ['href', 'single'],
    ['src', 'single'],
    ['action', 'single'],
    ['formaction', 'single'],
    ['poster', 'single'],
    ['cite', 'single'],
    ['xlink:href', 'single'],
    ['usemap', 'single'],
    ['ping', 'space-list'],
    ['archive', 'space-list'],
    ['srcset', 'srcset'],
    ['xmlns', 'refused'],
    ['xmlns:xlink', 'refused'],
    ['from', 'refused'],
    ['to', 'refused'],
    ['values', 'refused'],
  ])('%s is a %s attribute', (attribute, form) => {
    expect(urlAttributeForm(attribute)).toBe(form)
  })

  it.each([
    ['href', 'https://example.test/a'],
    ['src', '/img.png'],
    ['action', '/submit'],
    ['formaction', '/submit'],
    ['poster', '/p.jpg'],
    ['xlink:href', '#icon-star'],
  ])('passes a legitimate %s through unchanged', (attribute, value) => {
    expect(safeUrlAttribute(attribute, value)).toBe(value)
  })

  it.each([
    ['href', 'javascript:alert(1)'],
    ['src', 'data:text/html,<script>x()</script>'],
    ['action', '//evil.test/collect'],
    ['formaction', '/\\evil.test/collect'],
    ['poster', 'java\tscript:alert(1)'],
  ])('refuses a hostile %s', (attribute, value) => {
    expect(safeUrlAttribute(attribute, value)).toBe('#')
  })

  it.each([
    ['xmlns', 'http://www.w3.org/2000/svg'],
    ['values', '0;1;0'],
    ['from', '/a'],
    ['to', '/b'],
  ])('renders nothing for %s, which is not a single URL at all', (attribute, value) => {
    expect(safeUrlAttribute(attribute, value)).toBe('')
  })
})

describe('R-08 — the canonical link goes through the URL policy', () => {
  const documentFor = (canonical: string) =>
    renderPage({
      manifest: {
        page: { id: 'p', version_id: 'v', title: 'T', path: '/p' },
        meta: { canonical },
        sections: [],
      } as unknown as RenderManifest,
      shell: {
        site: { id: 's', name: 'S', slug: 's' },
        theme: {},
        navigation: [],
        canonical_host: 'example.test',
        staging_host: null,
      } as SiteShell,
      isStaging: false,
    }).html

  it.each([
    ['a protocol-relative host', '//evil.test/hijack'],
    ['an executable scheme', 'javascript:alert(1)'],
    ['a backslash authority', '/\\evil.test/hijack'],
  ])('refuses %s and falls back to the site’s own address', (_label, canonical) => {
    const html = documentFor(canonical)
    expect(html).not.toContain('evil.test')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<link rel="canonical" href="https://example.test/p">')
  })

  it('keeps an authored canonical that the policy allows', () => {
    expect(documentFor('https://example.test/other')).toContain(
      '<link rel="canonical" href="https://example.test/other">',
    )
  })
})

describe('R-10 — hidden_at names a breakpoint or names nothing', () => {
  const sectionWith = (hiddenAt: string[]) => {
    const compiled = compileSection({ sourceHtml: '<p>hi</p>', slots: [] })
    return renderSection(
      {
        def: {
          section_def_id: 'd',
          version: 1,
          slug: 'd',
          compiled_ast: compiled.ast,
          css: compiled.css,
          slots: [],
          render_hash: 'h',
          sanitizer_policy_version: SANITIZER_POLICY_VERSION,
          css_policy_version: CSS_POLICY_VERSION,
        },
        instance: { label: 'S', hidden: false, hidden_at: hiddenAt, values: {} },
      } as never,
      0,
    )
  }

  it('drops an entry that smuggles extra class names', () => {
    const html = sectionWith(['sm cms-section--other x'])
    expect(html).toBe('<div id="s0" class="cms-section cms-section--d"><p>hi</p></div>')
  })

  it.each([['sm'], ['md'], ['lg']])('keeps the real breakpoint %s', breakpoint => {
    expect(sectionWith([breakpoint])).toContain(`cms-hide-${breakpoint}`)
  })

  it('drops one that is simply not a breakpoint', () => {
    expect(sectionWith(['xl'])).not.toContain('cms-hide')
  })
})

describe('the URL sink and the tokenizer agree on what a URL attribute is', () => {
  it('classifies every attribute the tokenizer calls URL-bearing', () => {
    const unclassified = [...URL_ATTRIBUTES].filter(a => !(a in URL_ATTRIBUTE_FORMS))
    expect(unclassified, 'these would silently get the single-URL policy: add them to URL_ATTRIBUTE_FORM').toEqual([])
  })

  it('classifies nothing the tokenizer does not send here', () => {
    const stray = Object.keys(URL_ATTRIBUTE_FORMS).filter(a => !URL_ATTRIBUTES.has(a))
    expect(stray, 'these are classified but never reach the url-attribute sink').toEqual([])
  })
})

describe('R-05a — after a quoted value, HTML reconsumes; so does the scanner', () => {
  // Found while transcribing the register, not by the swarm. The scanner
  // consumed the character after a closing quote instead of reconsuming it, so
  // `<img src="x"onerror="…">` lost the `o`: the attribute read as `nerror`,
  // which does not begin with `on`, and a slot inside a live event handler was
  // classified `quoted-attribute` — a *safe* context — and compiled clean.
  it.each([
    ['no separator at all', '<img src="x"onerror="{{value}}">'],
    ['a solidus separator', '<img src="x"/onerror="{{value}}">'],
    ['the ordinary spaced form', '<img src="x" onerror="{{value}}">'],
    ['single quotes', "<img src='x'onerror='{{value}}'>"],
    ['an uppercase handler', '<img src="x"ONERROR="{{value}}">'],
  ])('sees the handler with %s', (_label, template) => {
    expect(scanSlotSites(template)[0]?.context).toBe('event-attribute')
  })

  it('refuses to compile the template at all', () => {
    const compiled = compileSection({
      sourceHtml: '<img src="x"onerror="{{value}}">',
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.blocking.join(' ')).toContain('event handler')
  })

  it('still reads the attribute after a quoted value correctly', () => {
    const site = scanSlotSites('<a href="y"title="{{value}}">')[0]
    expect(site?.context).toBe('quoted-attribute')
    expect(site?.attribute).toBe('title')
  })
})

describe('R-04a — a stylesheet inside a template is a stylesheet nobody checked', () => {
  it('needs approval, because the CSS policy never sees it', () => {
    // The CSS policy runs on a definition's sourceCss. A <style> element in the
    // template is markup, emitted verbatim, so it shipped `url(//evil.test/x)`
    // with neither the policy nor a reviewer involved.
    const compiled = compileSection({
      sourceHtml: '<style>.a{background:url(//evil.test/x)}</style><p>hi</p>',
      slots: [],
    })
    expect(compiled.carriesTrustedCode).toBe(true)
  })

  it('including the foreign-content spelling that carries no script token', () => {
    expect(
      compileSection({
        sourceHtml: '<svg><title><style>.a{background:url(//evil.test/x)}</style></title></svg>',
        slots: [],
      }).carriesTrustedCode,
    ).toBe(true)
  })
})
