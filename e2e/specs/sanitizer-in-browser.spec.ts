// Independent verification of the sanitizer, by a real HTML parser (SPEC §9).
//
// Everything else that checks this output is a regular expression written by
// the same person who wrote the escaper, and a regular expression agreeing with
// itself proves very little. Here the rendered result is put into a live
// Chromium document and inspected through the DOM: what elements actually
// exist, what attributes they actually carry, what requests the page actually
// makes, whether a dialog actually opens. Chromium's parser is the thing whose
// behaviour the sanitizer is trying to predict, so it is the only fair judge of
// whether the prediction was right.
//
// There is deliberately no Content-Security-Policy on these documents. CSP is
// defence in depth and belongs in front of the real app; using it here would
// mean a sanitizer bypass could pass this suite, which is the opposite of what
// the suite is for.
import { expect, test, type Page } from '@playwright/test'
import {
  CSS_POLICY_VERSION,
  collectCss,
  compileSection,
  renderPage,
  renderSection,
  scopeCss,
  type ManifestSection,
  type RenderManifest,
  type SiteShell,
} from '@cms/renderer'
import { MALICIOUS_CASES } from '@cms/renderer/fixtures'

const SHELL: SiteShell = {
  site: { id: 'site', name: 'Site', slug: 'site' },
  theme: {},
  navigation: [],
  canonical_host: null,
  staging_host: null,
}

type Slot = { id: string; kind: string; label: string; constraints: Record<string, never> }
const slots = (kind: string): Slot[] => [{ id: 'value', kind, label: 'Value', constraints: {} }]

function section(template: string, kind: string, value: unknown): ManifestSection {
  const compiled = compileSection({ sourceHtml: template, slots: slots(kind) as never })
  return {
    def: {
      section_def_id: 'd',
      version: 1,
      slug: 'd',
      compiled_ast: compiled.ast,
      css: compiled.css,
      slots: slots(kind),
      render_hash: 'h',
      sanitizer_policy_version: 2,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { label: 'S', hidden: false, hidden_at: [], values: { value } },
  } as unknown as ManifestSection
}

function page(template: string, kind: string, value: unknown): string {
  const manifest: RenderManifest = {
    page: { id: 'p', version_id: 'v', title: 'Title', path: '/p' },
    meta: {},
    sections: [section(template, kind, value)],
  } as unknown as RenderManifest
  return renderPage({ manifest, shell: SHELL, isStaging: false }).html
}

/** What a real parser found, and what the page actually tried to do. */
type Observed = {
  scripts: number
  eventHandlers: string[]
  javascriptUrls: string[]
  externalRequests: string[]
  dialogs: string[]
  consoleErrors: string[]
  styleElementCount: number
}

async function observe(browserPage: Page, html: string): Promise<Observed> {
  const dialogs: string[] = []
  const externalRequests: string[] = []
  const consoleErrors: string[] = []

  browserPage.on('dialog', dialog => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  browserPage.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  // Anything leaving the page is a finding: a stylesheet, an image, a font, a
  // beacon. Blocked rather than merely recorded, so a slow external host cannot
  // turn a security assertion into a flake.
  await browserPage.route('**', async (route, request) => {
    const url = request.url()
    if (!url.startsWith('about:') && !url.startsWith('data:')) externalRequests.push(url)
    await route.abort()
  })

  await browserPage.setContent(html, { waitUntil: 'domcontentloaded' })
  // Give anything that intended to run a moment to have run.
  await browserPage.waitForTimeout(30)

  const found = await browserPage.evaluate(() => {
    const handlers: string[] = []
    const jsUrls: string[] = []
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.toLowerCase().startsWith('on')) {
          handlers.push(`${element.tagName.toLowerCase()}@${attribute.name}`)
        }
        // Only attributes the browser actually resolves as URLs. `title` and
        // `alt` may contain the characters of a scheme and no capability — a
        // check that flags those is reporting successful escaping as a finding.
        const NAVIGATED = [
          'href',
          'src',
          'srcset',
          'action',
          'formaction',
          'poster',
          'data',
          'ping',
          'cite',
          'background',
          'xlink:href',
          'srcdoc',
        ]
        if (
          NAVIGATED.includes(attribute.name.toLowerCase()) &&
          /^\s*(javascript|vbscript|data:text\/html|data:image\/svg)/i.test(attribute.value)
        ) {
          jsUrls.push(`${element.tagName.toLowerCase()}@${attribute.name}=${attribute.value.slice(0, 60)}`)
        }
      }
    }
    // The browser's own resolution, not ours: whatever it decided these
    // properties mean is what a click or a load would follow.
    for (const element of Array.from(
      document.querySelectorAll('a,area,link,form,button,img,iframe,source,object,embed'),
    )) {
      const resolved = [
        (element as HTMLAnchorElement).href,
        (element as HTMLImageElement).src,
        (element as HTMLFormElement).action,
        (element as HTMLButtonElement).formAction,
      ]
      for (const url of resolved) {
        if (typeof url === 'string' && /^(javascript|vbscript|data:text\/html):/i.test(url)) {
          jsUrls.push(`${element.tagName.toLowerCase()}#resolved=${url.slice(0, 60)}`)
        }
      }
    }

    return {
      scripts: document.querySelectorAll('script').length,
      styleElementCount: document.querySelectorAll('style').length,
      handlers,
      jsUrls,
      // Elements the renderer never emits. If the parser found one, something
      // in a value became structure.
      forbidden: Array.from(
        document.querySelectorAll('iframe,object,embed,form,input,base,link,svg,math,template,noscript,textarea'),
      ).map(e => e.tagName.toLowerCase()),
    }
  })

  return {
    scripts: found.scripts,
    eventHandlers: found.handlers,
    javascriptUrls: found.jsUrls,
    externalRequests,
    dialogs,
    consoleErrors,
    styleElementCount: found.styleElementCount,
    ...({ forbidden: found.forbidden } as Record<string, unknown>),
  } as Observed & { forbidden: string[] }
}

function expectClean(observed: Observed & { forbidden?: string[] }, label: string): void {
  expect(observed.scripts, `${label}: script elements`).toBe(0)
  expect(observed.eventHandlers, `${label}: event handlers`).toEqual([])
  expect(observed.javascriptUrls, `${label}: executable URLs`).toEqual([])
  expect(observed.dialogs, `${label}: dialogs`).toEqual([])
  expect(observed.forbidden ?? [], `${label}: unexpected elements`).toEqual([])
  expect(observed.externalRequests, `${label}: external requests`).toEqual([])
  // Exactly one <style>, the shell's own. A second one came from content.
  expect(observed.styleElementCount, `${label}: style elements`).toBeLessThanOrEqual(1)
}

// Every corpus case, in every sink a value can reach — all of them in one
// document per case. One page load per payload rather than one per
// payload-and-sink: the assertions are the same and the suite finishes, and a
// suite that takes four minutes is a suite that gets skipped.
const TEMPLATES: { name: string; template: string; kind: string; wrap: (p: string) => unknown }[] = [
  { name: 'element text', template: '<section>{{value}}</section>', kind: 'text', wrap: p => p },
  { name: 'rich text', template: '<section>{{value}}</section>', kind: 'richtext', wrap: p => p },
  { name: 'title attribute', template: '<section title="{{value}}">x</section>', kind: 'text', wrap: p => p },
  { name: 'href attribute', template: '<section><a href="{{value}}">go</a></section>', kind: 'text', wrap: p => p },
  { name: 'style attribute', template: '<section style="{{value}}">x</section>', kind: 'text', wrap: p => p },
  { name: 'link slot', template: '<section>{{value}}</section>', kind: 'link', wrap: p => ({ url: p, label: p }) },
  { name: 'image slot', template: '<section>{{value}}</section>', kind: 'image', wrap: p => ({ src: p, alt: p }) },
]

/** One document carrying the payload in every sink at once. */
function everySink(payload: string, preview: boolean): string {
  const body = TEMPLATES.map((sink, index) =>
    renderSection(section(sink.template, sink.kind, sink.wrap(payload)), index, preview ? { preview: true } : {}),
  ).join('')
  const css = compileSection({
    sourceHtml: '<section>{{value}}</section>',
    sourceCss: payload,
    slots: slots('text') as never,
  }).css
  return `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`
}

test.describe('public output', () => {
  test('no corpus payload becomes structure, script, request or dialog', async ({ page: browserPage }) => {
    for (const malicious of MALICIOUS_CASES) {
      const observed = await observe(browserPage, everySink(malicious.payload, false))
      expectClean(observed, `${malicious.id} (${malicious.intent})`)
    }
  })

  test('a whole rendered page is clean, shell and all', async ({ page: browserPage }) => {
    for (const malicious of MALICIOUS_CASES) {
      const observed = await observe(browserPage, page('<section>{{value}}</section>', 'richtext', malicious.payload))
      expectClean(observed, `full page / ${malicious.id}`)
    }
  })
})

test.describe('preview output is held to the same standard', () => {
  test('instrumentation adds nodes but never capability', async ({ page: browserPage }) => {
    for (const malicious of MALICIOUS_CASES) {
      const observed = await observe(browserPage, everySink(malicious.payload, true))
      expectClean(observed, `preview / ${malicious.id} (${malicious.intent})`)
    }
  })

  test('preview and public differ only by instrumentation', async ({ page: browserPage }) => {
    const built = section('<section><a href="{{value}}">go</a></section>', 'text', '/about')
    const preview = renderSection(built, 0, { preview: true })
    const live = renderSection(built, 0, {})

    // Compared through the DOM rather than by string: the claim is that the two
    // documents are the same page, not that they are the same bytes.
    const strip = async (html: string): Promise<string> => {
      await browserPage.setContent(`<!doctype html><html><body>${html}</body></html>`)
      return browserPage.evaluate(() => {
        for (const span of Array.from(document.querySelectorAll('cms-slot[data-cms-slot]'))) {
          span.replaceWith(...Array.from(span.childNodes))
        }
        const walk = (node: Element): void => {
          for (const attribute of Array.from(node.attributes)) {
            if (attribute.name.startsWith('data-cms-')) node.removeAttribute(attribute.name)
          }
          for (const child of Array.from(node.children)) walk(child)
        }
        walk(document.body)
        return document.body.innerHTML
      })
    }
    expect(await strip(preview)).toBe(await strip(live))
  })

  test('an attribute-position slot is never wrapped in markup', async ({ page: browserPage }) => {
    // The wrapper is a `<span>`, and a `<span>` inside a quoted value is not a
    // node the editor can select — it is a broken attribute, in preview only.
    const html = renderSection(section('<section title="{{value}}">x</section>', 'text', 'hello'), 0, { preview: true })
    await browserPage.setContent(`<!doctype html><html><body>${html}</body></html>`)
    const title = await browserPage.evaluate(() => document.querySelector('section')?.getAttribute('title') ?? null)
    expect(title).toBe('hello')
  })
})

test.describe('the four reported reproductions, judged by Chromium', () => {
  test('a slot after </scriptx> does not execute', async ({ page: browserPage }) => {
    // The scanner used to leave raw text on any prefix of the end tag, so this
    // slot compiled as ordinary element text and the browser ran it. The value
    // sets a global, which is a thing the page can be asked about afterwards —
    // more direct evidence than "no dialog appeared".
    const template = '<script>/*</scriptx>*/{{value}}</script>'
    const built = section(template, 'text', 'globalThis.__pwned=1')
    const html = `<!doctype html><html><body>${renderSection(built, 0)}</body></html>`

    const observed = await observe(browserPage, html)
    expectClean(observed, 'raw-text prefix')
    expect(await browserPage.evaluate(() => (globalThis as Record<string, unknown>)['__pwned'] ?? null)).toBeNull()
  })

  test('a forged element-text context in a bare attribute position emits nothing', async ({ page: browserPage }) => {
    const forged = {
      nodes: [
        { kind: 'html', value: '<div ' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
        { kind: 'html', value: '>x</div>' },
      ],
      policyVersion: 3,
      cssPolicyVersion: 4,
    }
    const body = renderSection(
      {
        def: {
          section_def_id: 'd',
          version: 1,
          slug: 'd',
          compiled_ast: forged,
          css: '',
          slots: slots('text'),
          render_hash: 'h',
          sanitizer_policy_version: 3,
          css_policy_version: CSS_POLICY_VERSION,
        },
        instance: { label: 'S', hidden: false, hidden_at: [], values: { value: 'onclick=alert(1)' } },
      } as unknown as ManifestSection,
      0,
    )

    const observed = await observe(browserPage, `<!doctype html><html><body>${body}</body></html>`)
    expectClean(observed, 'forged context')
    expect(
      await browserPage.evaluate(() => Array.from(document.querySelectorAll('*')).some(e => e.hasAttribute('onclick'))),
    ).toBe(false)
  })

  const ESCAPED_URL_FORMS: [string, string][] = [
    ['an escaped url identifier', '.a{background:u\\72l(https://evil.test/x)}'],
    ['escaped upper case', '.a{background:U\\52 L(https://evil.test/x)}'],
    ['nested in image-set', '.a{background:image-set(u\\72l(https://evil.test/x) 1x)}'],
    ['a bare string in image-set', '.a{background:image-set("https://evil.test/x" 1x)}'],
  ]

  test('no escaped url form makes a request', async ({ page: browserPage }) => {
    for (const [label, css] of ESCAPED_URL_FORMS) {
      const html =
        `<!doctype html><html><head><style>${scopeCss(css, '.s').css}</style></head>` +
        `<body><div class="s"><div class="a">x</div></div></body></html>`
      const observed = await observe(browserPage, html)
      expectClean(observed, `escaped url: ${label}`)
      expect(observed.externalRequests, label).toEqual([])
    }
  })

  test('a same-origin background still loads', () => {
    // The counterpart assertion: refusing everything would also pass the test
    // above, and that is not the behaviour anyone wants.
    const { css } = scopeCss('.a{background:url(/ok.png)}', '.s')
    expect(css).toContain('url("/ok.png")')
  })
})

test.describe('the three further reproductions, judged by Chromium', () => {
  test('a script-data double-escaped template does not execute', async ({ page: browserPage }) => {
    // `<script><!--<script></script>-->` does not end where it appears to: the
    // inner close returns to the escaped state rather than closing the element.
    // The template is refused outright now, so there is nothing to run — the
    // assertion is that the global stays unset, which is a fact about the page
    // rather than about our own classification.
    const template = '<script><!--<script></script>-->\n{{value}}</script>'
    const built = section(template, 'text', 'globalThis.__doubleEscaped=1')
    const html = `<!doctype html><html><body>${renderSection(built, 0)}</body></html>`

    const observed = await observe(browserPage, html)
    expectClean(observed, 'script double-escaped')
    expect(
      await browserPage.evaluate(() => (globalThis as Record<string, unknown>)['__doubleEscaped'] ?? null),
    ).toBeNull()
  })

  test.describe('script tokenizer states, differentially', () => {
    const SCRIPT_SHAPES = [
      ['double escaped', '<script><!--<script></script>-->{{value}}</script>'],
      ['escaped comment', '<script><!-- </script> --> {{value}}</script>'],
      ['nested script text', '<script>var a = "<script>";</script>{{value}}'],
      ['mixed case', '<script><!--<SCRIPT></SCRIPT>-->{{value}}</script>'],
      ['two apparent closes', '<script></script></script>{{value}}'],
    ] as const

    test('no shape lets a slot become script', async ({ page: browserPage }) => {
      for (const [label, template] of SCRIPT_SHAPES) {
        const built = section(template, 'text', 'globalThis.__ran=1')
        const html = `<!doctype html><html><body>${renderSection(built, 0)}</body></html>`
        const observed = await observe(browserPage, html)
        expectClean(observed, `script shape: ${label}`)
        expect(
          await browserPage.evaluate(() => (globalThis as Record<string, unknown>)['__ran'] ?? null),
          label,
        ).toBeNull()
      }
    })
  })

  test('a slot id that closes its own marker emits nothing', async ({ page: browserPage }) => {
    const forged = {
      nodes: [
        { kind: 'html', value: '<p>' },
        { kind: 'slot', slotId: 'a}}</p><div title="', slotKind: 'text', context: 'element-text' },
        { kind: 'html', value: '</p><div ' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'quoted-attribute', attribute: 'title' },
        { kind: 'html', value: '>x</div>' },
      ],
      policyVersion: 4,
      cssPolicyVersion: 5,
    }
    const body = renderSection(
      {
        def: {
          section_def_id: 'd',
          version: 1,
          slug: 'd',
          compiled_ast: forged,
          css: '',
          slots: slots('text'),
          render_hash: 'h',
          sanitizer_policy_version: 4,
          css_policy_version: 5,
        },
        instance: { label: 'S', hidden: false, hidden_at: [], values: { value: 'onclick=alert(1)' } },
      } as unknown as ManifestSection,
      0,
    )

    const observed = await observe(browserPage, `<!doctype html><html><body>${body}</body></html>`)
    expectClean(observed, 'forged slot id')
    expect(
      await browserPage.evaluate(() => Array.from(document.querySelectorAll('*')).some(e => e.hasAttribute('onclick'))),
    ).toBe(false)
  })

  test('forged compiled CSS reaching a manifest makes no request', async ({ page: browserPage }) => {
    const FORGED = [
      ['at-rule wrapper', '@media all{body{background:url(https://evil.test/x)}}'],
      ['comma branch', '.cms-section--d .safe,body{background:url(https://evil.test/x)}'],
      ['scope lookalike', '.cms-section--devil body{background:url(https://evil.test/x)}'],
    ] as const

    for (const [label, css] of FORGED) {
      // Placed in a manifest the way a compromised row would reach one: claiming
      // the current policy version, with a perfectly valid AST beside it.
      const built = section('<section>{{value}}</section>', 'text', 'ok')
      const withCss = {
        ...built,
        def: { ...built.def, css, css_policy_version: 5 },
      } as unknown as ManifestSection
      const body = renderSection(withCss, 0)
      const collected = collectCss([withCss])
      const html = `<!doctype html><html><head><style>${collected}</style></head>` + `<body>${body}</body></html>`

      const observed = await observe(browserPage, html)
      expectClean(observed, `forged compiled css: ${label}`)
      expect(observed.externalRequests, label).toEqual([])
      // And the page is not restyled by somebody else's selectors either.
      expect(await browserPage.evaluate(() => getComputedStyle(document.body).display), label).not.toBe('none')
    }
  })
})

test.describe('selector scopes, judged by Chromium', () => {
  /** Does the browser think this stylesheet styles the victim element? */
  async function victimIsStyled(browserPage: import('@playwright/test').Page, css: string): Promise<string> {
    await browserPage.setContent(
      `<!doctype html><html><head><style>${css}</style></head>` +
        `<body><div class="cms-section--devil" id="victim">v</div></body></html>`,
    )
    return browserPage.evaluate(() => getComputedStyle(document.getElementById('victim')!).color)
  }

  test('the escaped selector really did cross scopes — Chromium says so', async ({ page: browserPage }) => {
    // The oracle for the bug, stated as a fact about the browser rather than
    // about our validator: this stylesheet styles a *different* definition's
    // sections. Written down so the reason the fix exists cannot be forgotten.
    const raw = String.raw`.cms-section--d\65 vil{color:rgb(1, 2, 3)}`
    expect(await victimIsStyled(browserPage, raw)).toBe('rgb(1, 2, 3)')
  })

  test('nothing that survives the policy can do that', async ({ page: browserPage }) => {
    const attempts = [
      String.raw`&\65 vil{color:rgb(1, 2, 3)}`,
      String.raw`&\65 \76 \69 \6c{color:rgb(1, 2, 3)}`,
      '&evil{color:rgb(1, 2, 3)}',
      String.raw`.cms-section--d\65 vil{color:rgb(1, 2, 3)}`,
    ]
    for (const authored of attempts) {
      const { css } = scopeCss(authored, '.cms-section--d')
      // Either nothing shipped, or what shipped does not reach the victim.
      expect(await victimIsStyled(browserPage, css), authored).not.toBe('rgb(1, 2, 3)')
    }
  })

  test('a legitimate scoped rule still styles its own section', async ({ page: browserPage }) => {
    // The counterpart: refusing everything would also pass the test above.
    const { css } = scopeCss('.a{color:rgb(1, 2, 3)}', '.cms-section--d')
    await browserPage.setContent(
      `<!doctype html><html><head><style>${css}</style></head>` +
        `<body><div class="cms-section--d"><span class="a" id="own">o</span></div></body></html>`,
    )
    expect(await browserPage.evaluate(() => getComputedStyle(document.getElementById('own')!).color)).toBe(
      'rgb(1, 2, 3)',
    )
  })

  test('a compiled artifact that crosses scopes never reaches the page', async ({ page: browserPage }) => {
    const built = section('<section>{{value}}</section>', 'text', 'ok')
    const forged = {
      ...built,
      def: {
        ...built.def,
        css: String.raw`.cms-section--d\65 vil{color:rgb(1, 2, 3)}`,
        css_policy_version: CSS_POLICY_VERSION,
        slug: 'd',
      },
    } as unknown as ManifestSection
    const html =
      `<!doctype html><html><head><style>${collectCss([forged])}</style></head>` +
      `<body><div class="cms-section--devil" id="victim">v</div>${renderSection(forged, 0)}</body></html>`

    const observed = await observe(browserPage, html)
    expectClean(observed, 'cross-scope compiled artifact')
    expect(await browserPage.evaluate(() => getComputedStyle(document.getElementById('victim')!).color)).not.toBe(
      'rgb(1, 2, 3)',
    )
  })
})

test.describe('what the audit swarm found, judged by Chromium', () => {
  test('foreign content really does run a script the walk cannot see', async ({ page: browserPage }) => {
    // The premise first. If Chromium did not execute these, the compiler rule
    // that refuses them would be superstition rather than a defence.
    for (const markup of [
      '<svg><title><script>window.__p=1</script></title></svg>',
      '<svg><textarea><script>window.__p=1</script></textarea></svg>',
      '<svg><style><script>window.__p=1</script></style></svg>',
      '<math><mtext><script>window.__p=1</script></mtext></math>',
    ]) {
      await browserPage.setContent(`<!doctype html><body>${markup}`)
      await browserPage.waitForTimeout(30)
      expect(await browserPage.evaluate(() => (window as unknown as { __p?: number }).__p), markup).toBe(1)
      await browserPage.evaluate(() => {
        delete (window as unknown as { __p?: number }).__p
      })
    }
  })

  test('and a template that conceals one never compiles', async () => {
    const compiled = compileSection({
      sourceHtml: '<svg><title><script>window.__p=1</script></title></svg><p>{{value}}</p>',
      slots: slots('text') as never,
    })
    expect(compiled.blocking.length).toBeGreaterThan(0)
  })

  test('a srcset list cannot smuggle an off-site candidate', async ({ page: browserPage }) => {
    const html = page('<img src="/a.png" srcset="{{value}}">', 'text', '/a.png 1x, //evil.test/x.png 2x')
    const observed = await observe(browserPage, html)
    expectClean(observed, 'srcset list')
    expect(observed.externalRequests.join(' ')).not.toContain('evil.test')
  })

  test('and a legitimate srcset still survives the policy', async ({ page: browserPage }) => {
    const html = page('<img src="/a.png" srcset="{{value}}">', 'text', '/a.png 1x, /b.png 2x')
    await browserPage.route('**', route => route.abort())
    await browserPage.setContent(html, { waitUntil: 'domcontentloaded' })
    expect(await browserPage.evaluate(() => document.querySelector('img')?.getAttribute('srcset'))).toBe(
      '/a.png 1x, /b.png 2x',
    )
  })
})

test.describe('the rest of the swarm ledger, judged by Chromium', () => {
  test('a backslash authority really is off-site, and the policy stops it', async ({ page: browserPage }) => {
    // Premise: Chromium resolves `/\evil.test/x` exactly like `//evil.test/x`.
    await browserPage.route('**', route => route.abort())
    // A real base URL: `setContent` alone leaves the document at about:blank,
    // where a relative URL has no host to resolve against and the premise
    // cannot be stated at all.
    await browserPage.setContent(
      '<!doctype html><base href="https://example.test/"><a id="raw" href="/\\evil.test/phish">x</a>',
    )
    expect(await browserPage.evaluate(() => (document.getElementById('raw') as HTMLAnchorElement).host)).toBe(
      'evil.test',
    )

    const html = page('<a href="{{value}}">go</a>', 'text', '/\\evil.test/phish')
    const observed = await observe(browserPage, html)
    expectClean(observed, 'backslash authority')
    await browserPage.setContent(html, { waitUntil: 'domcontentloaded' })
    expect(await browserPage.evaluate(() => Array.from(document.querySelectorAll('a')).map(a => a.host))).not.toContain(
      'evil.test',
    )
  })

  test('a slash-delimited handler is a handler, and needs approval', async ({ page: browserPage }) => {
    // Premise for R-05: Chromium normalises `<img/onerror=…>` into an image
    // with a live handler, which is why the approval gate has to see it.
    await browserPage.route('**', route => route.abort())
    await browserPage.setContent('<!doctype html><body><img/onerror="window.__p=1" src="/missing.png">')
    await browserPage.waitForTimeout(60)
    expect(await browserPage.evaluate(() => (window as unknown as { __p?: number }).__p)).toBe(1)

    expect(compileSection({ sourceHtml: '<img/onerror="window.__p=1" src=q>', slots: [] }).carriesTrustedCode).toBe(
      true,
    )
  })

  test('a script hidden behind `</>` does not become a slot sink', async ({ page: browserPage }) => {
    const compiled = compileSection({
      sourceHtml: '</><script>var a="{{value}}";</script>',
      slots: slots('text') as never,
    })
    expect(compiled.blocking.length).toBeGreaterThan(0)

    // And the page that would have shipped: nothing runs.
    const observed = await observe(browserPage, page('</><p title="{{value}}">x</p>', 'text', '";window.__p=1;//'))
    expectClean(observed, 'end tag with no name')
  })

  test('a hijacked canonical never reaches the document head', async ({ page: browserPage }) => {
    const manifest = {
      page: { id: 'p', version_id: 'v', title: 'T', path: '/p' },
      meta: { canonical: '//evil.test/hijack' },
      sections: [],
    } as unknown as RenderManifest
    const { html } = renderPage({
      manifest,
      shell: { ...SHELL, canonical_host: 'example.test' },
      isStaging: false,
    })
    // Not expectClean: this document is *supposed* to carry a <link>, and the
    // question is only which href it carries.
    const observed = await observe(browserPage, html)
    expect(observed.externalRequests.join(' '), 'canonical hijack: requests').not.toContain('evil.test')
    expect(observed.javascriptUrls, 'canonical hijack: executable URLs').toEqual([])
    expect(await browserPage.evaluate(() => document.querySelector('link[rel=canonical]')?.getAttribute('href'))).toBe(
      'https://example.test/p',
    )
  })
})

test.describe('the residuals found while writing the register', () => {
  test('a handler with no space before it is a handler, and Chromium agrees', async ({ page: browserPage }) => {
    await browserPage.route('**', route => route.abort())
    await browserPage.setContent('<!doctype html><body><img src="/missing.png"onerror="window.__p=1">')
    await browserPage.waitForTimeout(60)
    // The premise: HTML reconsumes after a quoted value, so this really is an
    // onerror attribute and it really does fire.
    expect(await browserPage.evaluate(() => document.querySelector('img')?.hasAttribute('onerror'))).toBe(true)
    expect(await browserPage.evaluate(() => (window as unknown as { __p?: number }).__p)).toBe(1)

    // And the compiler now refuses to put an editable value there.
    const compiled = compileSection({
      sourceHtml: '<img src="x"onerror="{{value}}">',
      slots: slots('text') as never,
    })
    expect(compiled.blocking.join(' ')).toContain('event handler')
  })
})
