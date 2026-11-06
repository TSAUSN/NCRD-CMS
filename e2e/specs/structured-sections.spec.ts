// The structured section model (ADR 0007), judged by Chromium and by the live
// site rather than by the code that produced the markup.
//
// Everything else that checks this output is a regular expression written by
// whoever wrote the serializer, and a regular expression agreeing with itself
// proves very little. Here the rendered result goes into a real document and is
// inspected through the DOM: what elements exist, what attributes they carry,
// what the page actually tried to fetch, whether anything ran. Chromium's parser
// is the thing the model is trying to predict, so it is the only fair judge of
// whether the prediction was right.
//
// There is deliberately no Content-Security-Policy on the documents built here.
// CSP belongs in front of the real app and is defence in depth; using it in this
// file would mean a serializer bug could pass, which is the opposite of what the
// file is for. The last describe block does use the real app, headers and all.
import { expect, test, type Page } from '@playwright/test'
import { STRUCTURED_SCHEMA_VERSION, type StructuredFieldDef, type StructuredNode } from '@cms/schema'
import {
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  collectCss,
  compileStructuredSection,
  renderSection,
  type ManifestSection,
  type SectionDefView,
} from '@cms/renderer'
import { MALICIOUS_CASES } from '@cms/renderer/fixtures'
import { SEED_SECTION_DEFS, seedSectionDefView } from '@cms/seeds'
import { STAGING_ORIGIN, fetchPublic } from './helpers.ts'

/** The empty compiled template every structured row stores (migration 0019). */
const NO_TEMPLATE = { nodes: [], policyVersion: SANITIZER_POLICY_VERSION, cssPolicyVersion: CSS_POLICY_VERSION }

function structuredDef(
  fields: StructuredFieldDef[],
  nodes: StructuredNode[],
  overrides: Partial<SectionDefView> = {},
): SectionDefView {
  return {
    section_def_id: 'd',
    version: 1,
    slug: 'structured',
    compiled_ast: NO_TEMPLATE,
    definition_kind: 'structured',
    structured_doc: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields, nodes },
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    ...overrides,
  }
}

function section(def: SectionDefView, values: Record<string, unknown>): ManifestSection {
  return { def, instance: { section_def_id: 'd', section_def_version: 1, values } } as ManifestSection
}

/**
 * One document carrying the payload in every field type at once.
 *
 * One page load per payload rather than one per payload-and-field: the
 * assertions are identical and a suite that takes four minutes is a suite people
 * skip.
 */
const FIELD_TYPES = ['text', 'richtext', 'link', 'image'] as const

function everyField(payload: string, preview: boolean): string {
  const body = FIELD_TYPES.map((type, index) => {
    const def = structuredDef(
      [{ name: 'value', type, label: 'Value' }],
      [{ type: 'element', tag: 'section', children: [{ type, field: 'value' }] }],
    )
    const value =
      type === 'link' ? { url: payload, label: payload } : type === 'image' ? { src: payload, alt: payload } : payload
    return renderSection(section(def, { value }), index, preview ? { preview: true } : {})
  }).join('')

  // The stylesheet half, through the same policy the interpolation model uses:
  // authored CSS in, scoped and validated CSS out, and the payload as the
  // author's own stylesheet.
  const css = compileStructuredSection({
    slug: 'structured',
    document: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [] },
    sourceCss: payload,
  }).css
  return `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`
}

type Observed = {
  scripts: number
  eventHandlers: string[]
  executableUrls: string[]
  externalRequests: string[]
  dialogs: string[]
  forbidden: string[]
}

async function observe(browserPage: Page, html: string): Promise<Observed> {
  const dialogs: string[] = []
  const externalRequests: string[] = []

  browserPage.on('dialog', dialog => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  // Anything leaving the page is a finding: a stylesheet, an image, a font, a
  // beacon. Aborted rather than merely recorded, so a slow host cannot turn a
  // security assertion into a flake.
  await browserPage.route('**', async (route, request) => {
    const url = request.url()
    if (!url.startsWith('about:') && !url.startsWith('data:')) externalRequests.push(url)
    await route.abort()
  })

  await browserPage.setContent(html, { waitUntil: 'domcontentloaded' })
  await browserPage.waitForTimeout(30)

  const found = await browserPage.evaluate(() => {
    const handlers: string[] = []
    const executable: string[] = []
    // Only attributes the browser actually resolves as URLs. `alt` and
    // `aria-label` may contain the characters of a scheme and none of its
    // capability, and flagging those reports successful escaping as a finding.
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
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.toLowerCase().startsWith('on')) {
          handlers.push(`${element.tagName.toLowerCase()}@${attribute.name}`)
        }
        if (
          NAVIGATED.includes(attribute.name.toLowerCase()) &&
          /^\s*(javascript|vbscript|data:text\/html|data:image\/svg)/i.test(attribute.value)
        ) {
          executable.push(`${element.tagName.toLowerCase()}@${attribute.name}`)
        }
      }
    }
    // The browser's own resolution, not ours: whatever it decided these
    // properties mean is what a click or a load would follow.
    for (const element of Array.from(document.querySelectorAll('a,img,area,link,form,button,iframe,object,embed'))) {
      for (const url of [(element as HTMLAnchorElement).href, (element as HTMLImageElement).src]) {
        if (typeof url === 'string' && /^(javascript|vbscript|data:text\/html):/i.test(url)) {
          executable.push(`${element.tagName.toLowerCase()}#resolved`)
        }
      }
    }
    return {
      scripts: document.querySelectorAll('script').length,
      handlers,
      executable,
      // Elements the structured renderer never emits, because they are not in
      // the tag allowlist and no field produces them. If the parser found one,
      // something in a stored value became structure.
      forbidden: Array.from(
        document.querySelectorAll(
          'iframe,object,embed,form,input,button,textarea,select,base,link,meta,svg,math,template,noscript',
        ),
      ).map(e => e.tagName.toLowerCase()),
    }
  })

  return {
    scripts: found.scripts,
    eventHandlers: found.handlers,
    executableUrls: found.executable,
    externalRequests,
    dialogs,
    forbidden: found.forbidden,
  }
}

function expectClean(observed: Observed, label: string): void {
  expect(observed.scripts, `${label}: script elements`).toBe(0)
  expect(observed.eventHandlers, `${label}: event handlers`).toEqual([])
  expect(observed.executableUrls, `${label}: executable URLs`).toEqual([])
  expect(observed.externalRequests, `${label}: external requests`).toEqual([])
  expect(observed.dialogs, `${label}: dialogs`).toEqual([])
  expect(observed.forbidden, `${label}: unexpected elements`).toEqual([])
}

test.describe('structured output, judged by Chromium', () => {
  test('no corpus payload becomes structure, script, request or dialog', async ({ page }) => {
    for (const malicious of MALICIOUS_CASES) {
      const observed = await observe(page, everyField(malicious.payload, false))
      expectClean(observed, `${malicious.id} (${malicious.intent})`)
    }
  })

  test('preview instrumentation adds nodes but never capability', async ({ page }) => {
    for (const malicious of MALICIOUS_CASES) {
      const observed = await observe(page, everyField(malicious.payload, true))
      expectClean(observed, `preview / ${malicious.id} (${malicious.intent})`)
    }
  })

  test('a stored attribute value cannot become an attribute at all', async ({ page }) => {
    // The case with no analogue in the interpolation model. Attributes are
    // static, so a payload can only reach one by being written into the stored
    // document — and the whole definition is refused rather than escaped into
    // something that renders.
    for (const malicious of MALICIOUS_CASES) {
      const def = structuredDef(
        [{ name: 'value', type: 'text', label: 'Value' }],
        [
          {
            type: 'element',
            tag: 'section',
            attributes: { class: malicious.payload },
            children: [{ type: 'text', field: 'value' }],
          },
        ],
      )
      expect(renderSection(section(def, { value: 'x' }), 0), malicious.id).toBe('')
    }
  })

  test('a definition’s stylesheet cannot reach a different definition’s sections', async ({ page }) => {
    const { css } = compileStructuredSection({
      slug: 'structured',
      document: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [] },
      // The three shapes ADR 0005's third amendment is about, all of which read
      // as a class this definition does not own once the escapes resolve.
      sourceCss: String.raw`&\65 vil{color:rgb(1, 2, 3)}` + '.a{color:rgb(1, 2, 3)}',
    })
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head>` +
        `<body><div class="cms-section--structuredevil" id="victim">v</div></body></html>`,
    )
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('victim')!).color)).not.toBe(
      'rgb(1, 2, 3)',
    )
  })

  test('a structured section whose compiled CSS crosses scopes never reaches the page', async ({ page }) => {
    const def = structuredDef(
      [{ name: 'value', type: 'text', label: 'Value' }],
      [{ type: 'element', tag: 'section', children: [{ type: 'text', field: 'value' }] }],
      { css: String.raw`.cms-section--structured\65 vil{color:rgb(1, 2, 3)}`, css_policy_version: CSS_POLICY_VERSION },
    )
    const built = section(def, { value: 'x' })
    const html =
      `<!doctype html><html><head><style>${collectCss([built])}</style></head>` +
      `<body><div class="cms-section--structuredevil" id="victim">v</div>${renderSection(built, 0)}</body></html>`

    const observed = await observe(page, html)
    expectClean(observed, 'cross-scope structured artifact')
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('victim')!).color)).not.toBe(
      'rgb(1, 2, 3)',
    )
  })
})

test.describe('preview and public differ only by instrumentation', () => {
  const def = structuredDef(
    [
      { name: 'heading', type: 'text', label: 'Heading' },
      { name: 'body', type: 'richtext', label: 'Body' },
      { name: 'cta', type: 'link', label: 'Call to action' },
      { name: 'portrait', type: 'image', label: 'Portrait' },
    ],
    [
      {
        type: 'element',
        tag: 'section',
        attributes: { class: 'quote', id: 'q1' },
        children: [
          { type: 'element', tag: 'h2', children: [{ type: 'text', field: 'heading' }] },
          { type: 'element', tag: 'div', children: [{ type: 'richtext', field: 'body' }] },
          { type: 'link', field: 'cta' },
          { type: 'image', field: 'portrait' },
        ],
      },
    ],
  )
  const values = {
    heading: 'A heading',
    body: '<p>Some <em>text</em>.</p>',
    cta: { url: '/about', label: 'About' },
    portrait: { src: '/a.png', alt: 'A photograph' },
  }

  test('the two documents are the same page once the instrumentation is removed', async ({ page }) => {
    // Compared through the DOM rather than by string: the claim is that the two
    // are the same page, not that they are the same bytes.
    const strip = async (html: string): Promise<string> => {
      await page.setContent(`<!doctype html><html><body>${html}</body></html>`)
      return page.evaluate(() => {
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
    const built = section(def, values)
    expect(await strip(renderSection(built, 0, { preview: true }))).toBe(await strip(renderSection(built, 0)))
  })

  test('public output carries no editor attribute, and preview marks every field', async ({ page }) => {
    const built = section(def, values)
    await page.setContent(`<!doctype html><body>${renderSection(built, 0)}`)
    expect(await page.evaluate(() => document.querySelectorAll('[data-cms-slot]').length)).toBe(0)

    await page.setContent(`<!doctype html><body>${renderSection(built, 0, { preview: true })}`)
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-cms-slot]')).map(e => e.getAttribute('data-cms-slot')),
      ),
    ).toEqual(['heading', 'body', 'cta', 'portrait'])
  })
})

test.describe('the seeded site, which now publishes both models', () => {
  test('serves both models as real markup, from one published page', async () => {
    const { status, body } = await fetchPublic()
    expect(status).toBe(200)
    // The hero and the text block are structured definitions; the call to
    // action is still on the interpolation path. All three are on this page.
    for (const slug of ['hero', 'prose', 'cta']) {
      expect(body, slug).toContain(`class="cms-section cms-section--${slug}"`)
    }
    // Deliberately not the seeded heading text. The editor specs run before this
    // one against the same site and leave their own words in that field, and a
    // spec that asserts on somebody else's fixture fails for a reason that has
    // nothing to do with what it is testing.
    expect(body).toMatch(/<h1>[^<]+<\/h1>/)
    expect(body).toContain('<strong>immutable definition version</strong>')
    // A real page applies the site's governed button hook to button slots;
    // the same definition rendered alone stays byte-identical for importer
    // parity. This is presentation semantics, not editor instrumentation.
    expect(body).toContain('<a class="cms-button" href="/">Open the editor</a>')
  })

  test('needs no JavaScript for its content, and carries no script element', async () => {
    const { body } = await fetchPublic()
    expect(body).not.toMatch(/<script/i)
    expect(body).not.toMatch(/\son[a-z]+\s*=/i)
    expect(body).not.toContain('data-cms-slot')
  })

  test.describe('with JavaScript disabled in the browser', () => {
    test.use({ javaScriptEnabled: false })

    test('a structured section still shows its heading and its body copy', async ({ page }) => {
      const response = await page.goto(`${STAGING_ORIGIN}/`)
      expect(response!.status()).toBe(200)
      await expect(page.locator('.cms-section--hero h1')).toBeVisible()
      await expect(page.locator('.cms-section--hero h1')).not.toBeEmpty()
      await expect(page.locator('.cms-section--prose strong')).toHaveText('immutable definition version')
    })

    test('the page makes no request to anywhere but its own host', async ({ page }) => {
      const offsite: string[] = []
      page.on('request', request => {
        if (!request.url().startsWith(STAGING_ORIGIN)) offsite.push(request.url())
      })
      await page.goto(`${STAGING_ORIGIN}/`)
      expect(offsite).toEqual([])
    })
  })
})

test.describe('the seed itself carries both models', () => {
  test('has at least one definition of each kind, and renders each', async ({ page }) => {
    const kinds = new Set(SEED_SECTION_DEFS.map(def => seedSectionDefView(def).definition_kind))
    expect(kinds).toEqual(new Set(['legacy', 'structured']))

    // The V1 pull quote, rendered in a real document. It is the conversion of a
    // definition shared by all three V1 sites, and the point of choosing it was
    // that it needs no icon sprite, no form, no iframe and none of V1's
    // interaction-preset stylesheet.
    const quote = SEED_SECTION_DEFS.find(def => def.slug === 'quote')!
    const built = section(seedSectionDefView(quote), {
      'quote-text': '<p>One strong sentence.</p>',
      'quote-name': 'Firstname Lastname',
      'quote-role': 'Title, Organization',
    })
    const html =
      `<!doctype html><html><head><style>${collectCss([built])}</style></head>` +
      `<body>${renderSection(built, 0)}</body></html>`

    const observed = await observe(page, html)
    expectClean(observed, 'seeded pull quote')
    expect(await page.evaluate(() => document.querySelector('blockquote.cms-section-quote__text')?.textContent)).toBe(
      'One strong sentence.',
    )
  })
})
