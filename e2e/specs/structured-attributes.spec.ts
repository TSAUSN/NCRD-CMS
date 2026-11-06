// The definition-owned attributes of a link or image field node (ADR 0008),
// judged by Chromium rather than by the code that produced the markup.
//
// Everything else that checks this output is an assertion about a string,
// written by whoever wrote the serializer, and a string agreeing with itself
// proves very little about a page. The claims here are the ones only a browser
// can settle: that the class the definition wrote is the class the stylesheet
// actually matches, that the width and height it declared are the box the
// element actually occupies, and that a link opened in a new tab really does
// carry the relationship that keeps the opened document from reaching back.
//
// There is deliberately no Content-Security-Policy on the documents built here,
// for the reason `structured-sections.spec.ts` gives: CSP belongs in front of
// the real app and is defence in depth, and using it here would let a serializer
// bug pass.
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

/** The empty compiled template every structured row stores (migration 0019). */
const NO_TEMPLATE = { nodes: [], policyVersion: SANITIZER_POLICY_VERSION, cssPolicyVersion: CSS_POLICY_VERSION }

const SLUG = 'attributes'

function structuredDef(fields: StructuredFieldDef[], nodes: StructuredNode[], sourceCss = ''): SectionDefView {
  const document = { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields, nodes }
  // Through the authoring compiler rather than around it, so the stylesheet on
  // the page is the artifact the database would have been given.
  const compiled = compileStructuredSection({ slug: SLUG, document, sourceCss })
  expect(compiled.blocking, 'the fixture definition must compile cleanly').toEqual([])
  return {
    section_def_id: 'd',
    version: 1,
    slug: SLUG,
    compiled_ast: NO_TEMPLATE,
    definition_kind: 'structured',
    structured_doc: document,
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    css: compiled.css,
    css_policy_version: CSS_POLICY_VERSION,
  }
}

function section(def: SectionDefView, values: Record<string, unknown>): ManifestSection {
  return { def, instance: { section_def_id: 'd', section_def_version: 1, values } } as ManifestSection
}

/** One section, its own stylesheet, and nothing else. */
function documentFor(built: ManifestSection, preview = false): string {
  return (
    `<!doctype html><html><head><style>${collectCss([built])}</style></head>` +
    `<body>${renderSection(built, 0, preview ? { preview: true } : {})}</body></html>`
  )
}

type Observed = {
  scripts: number
  eventHandlers: string[]
  executableUrls: string[]
  externalRequests: string[]
  dialogs: string[]
  forbidden: string[]
}

/**
 * What the page turned out to be, read out of the DOM the parser built.
 *
 * A local copy of the observer in `structured-sections.spec.ts` rather than a
 * shared helper: `helpers.ts` is about driving the running app, and a security
 * observer that two files share is one that a change made for one of them can
 * silently weaken for the other.
 */
async function observe(browserPage: Page, html: string): Promise<Observed> {
  const dialogs: string[] = []
  const externalRequests: string[] = []

  browserPage.on('dialog', dialog => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  // Anything leaving the page is a finding, and aborted rather than merely
  // recorded so a slow host cannot turn a security assertion into a flake.
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

// ------------------------------------------------------------ the class works

test.describe('the class a definition wrote is the class the stylesheet matches', () => {
  const def = (staticAttributes: Record<string, unknown>) =>
    structuredDef(
      [{ name: 'cta', type: 'link', label: 'Call to action' }],
      [{ type: 'link', field: 'cta', staticAttributes } as StructuredNode],
      '.cta-button{color:rgb(1, 2, 3);padding:8px}.cta-button.is-wide{letter-spacing:3px}',
    )
  const values = { cta: { url: '/about', label: 'About' } }

  test('styles the anchor itself rather than anything around it', async ({ page }) => {
    // The inventory calls some V1 classes "wrapper-capable", and moving one onto
    // a wrapper would change which selectors match. So the class goes on the
    // element the definition put it on, and this is the assertion that says the
    // difference is real rather than pedantic: `.cta-button` is a selector that
    // matches an anchor and nothing else on the page.
    await page.setContent(documentFor(section(def({ class: ['cta-button'] }), values)))
    const styled = await page.evaluate(() => {
      const anchor = document.querySelector('a')!
      return {
        tag: anchor.tagName.toLowerCase(),
        classes: Array.from(anchor.classList),
        color: getComputedStyle(anchor).color,
        parentColor: getComputedStyle(anchor.parentElement!).color,
      }
    })
    expect(styled.tag).toBe('a')
    expect(styled.classes).toEqual(['cta-button'])
    expect(styled.color).toBe('rgb(1, 2, 3)')
    expect(styled.parentColor).not.toBe('rgb(1, 2, 3)')
  })

  test('matches a compound selector, so several tokens are several classes', async ({ page }) => {
    // The token list has to arrive as separate class names rather than as one
    // name with a space in it, and `.a.b` is the selector that can tell the
    // difference: it matches only if the browser split them into two.
    await page.setContent(documentFor(section(def({ class: ['cta-button', 'is-wide'] }), values)))
    const styled = await page.evaluate(() => {
      const anchor = document.querySelector('a')!
      return { classes: Array.from(anchor.classList), spacing: getComputedStyle(anchor).letterSpacing }
    })
    expect(styled.classes).toEqual(['cta-button', 'is-wide'])
    expect(styled.spacing).toBe('3px')
  })

  test('leaves the class off entirely when the definition asked for none', async ({ page }) => {
    await page.setContent(
      documentFor(
        section(
          structuredDef([{ name: 'cta', type: 'link', label: 'Call to action' }], [{ type: 'link', field: 'cta' }]),
          values,
        ),
      ),
    )
    expect(await page.evaluate(() => document.querySelector('a')!.hasAttribute('class'))).toBe(false)
  })
})

// ------------------------------------------------------- the box is reserved

test.describe('an image occupies the box its definition declared', () => {
  const def = (staticAttributes?: Record<string, unknown>) =>
    structuredDef(
      [{ name: 'picture', type: 'image', label: 'Picture' }],
      [{ type: 'image', field: 'picture', ...(staticAttributes ? { staticAttributes } : {}) } as StructuredNode],
    )
  const values = { picture: { src: '/pictures/harbour.png', alt: 'Boats in a harbour' } }

  // These tests are served from an origin rather than through `setContent`,
  // because the claim is about a real image: a relative `src` on an
  // `about:blank` document never resolves to anything, and an image that never
  // loads has no intrinsic size for the declared one to be compared against.
  const ORIGIN = 'http://section.test'
  /** Two pixels by one, so an intrinsic size is nothing like a declared one. */
  const PICTURE = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC',
    'base64',
  )

  async function show(page: Page, html: string): Promise<string[]> {
    const requested: string[] = []
    await page.route('**', async (route, request) => {
      const url = request.url()
      requested.push(url)
      if (!url.startsWith(ORIGIN)) return route.abort()
      if (url.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: PICTURE })
      return route.fulfill({ contentType: 'text/html', body: html })
    })
    await page.goto(`${ORIGIN}/`)
    await page.locator('img').evaluate((image: HTMLImageElement) =>
      image.complete
        ? undefined
        : new Promise(done => {
            image.onload = () => done(undefined)
          }),
    )
    return requested
  }

  const boxOf = (page: Page) =>
    page.evaluate(() => {
      const image = document.querySelector('img')!
      const rect = image.getBoundingClientRect()
      return {
        attributes: [image.getAttribute('width'), image.getAttribute('height')],
        intrinsic: [image.naturalWidth, image.naturalHeight],
        laidOut: [Math.round(rect.width), Math.round(rect.height)],
      }
    })

  test('lays the image out at the size the definition declared, not the size the file is', async ({ page }) => {
    // The whole point of carrying `width` and `height`: the box is decided by
    // the definition, so it is the same box before the bytes arrive as after,
    // and the page does not move. The picture served here is two pixels by one.
    const requested = await show(page, documentFor(section(def({ width: 640, height: 360 }), values)))
    expect(await boxOf(page)).toEqual({
      attributes: ['640', '360'],
      intrinsic: [2, 1],
      laidOut: [640, 360],
    })
    expect(requested.filter(url => !url.startsWith(ORIGIN))).toEqual([])
  })

  test('falls back to the size the file is when the definition declared none', async ({ page }) => {
    // The counterpart every "it works" test needs. Without the pair the browser
    // has nothing to reserve until the image arrives, and the box it ends up
    // with is the picture's own — which is the layout shift the attributes exist
    // to prevent.
    await show(page, documentFor(section(def(), values)))
    expect(await boxOf(page)).toEqual({
      attributes: [null, null],
      intrinsic: [2, 1],
      laidOut: [2, 1],
    })
  })

  test('carries its loading hints to the element the browser reads them from', async ({ page }) => {
    await page.setContent(
      documentFor(
        section(
          def({
            class: ['media'],
            width: 640,
            height: 360,
            decoding: 'async',
            loading: 'lazy',
            fetchpriority: 'high',
          }),
          values,
        ),
      ),
    )
    expect(
      await page.evaluate(() => {
        const image = document.querySelector('img')!
        return { decoding: image.decoding, loading: image.loading, classes: Array.from(image.classList) }
      }),
    ).toEqual({ decoding: 'async', loading: 'lazy', classes: ['media'] })
  })
})

// ------------------------------------------------------------ link behaviour

test.describe('a link behaves the way its definition and this renderer agreed', () => {
  const def = (staticAttributes?: Record<string, unknown>) =>
    structuredDef(
      [{ name: 'cta', type: 'link', label: 'Call to action' }],
      [{ type: 'link', field: 'cta', ...(staticAttributes ? { staticAttributes } : {}) } as StructuredNode],
    )

  const anchorOf = (page: Page) =>
    page.evaluate(() => {
      const anchor = document.querySelector('a')!
      return {
        target: anchor.target,
        rel: anchor.rel,
        relList: Array.from(anchor.relList).sort(),
        href: anchor.getAttribute('href'),
        resolved: anchor.href,
        text: anchor.textContent,
      }
    })

  test('opens in a new tab with the relationship the renderer guarantees', async ({ page }) => {
    // Read through `relList`, which is the browser's own parse of the attribute
    // rather than ours. A link that says `_blank` hands the opened document a
    // live `window.opener`, and the definition was never asked to remember that.
    await page.setContent(documentFor(section(def({ target: '_blank' }), { cta: { url: '/about', label: 'About' } })))
    const anchor = await anchorOf(page)
    expect(anchor.target).toBe('_blank')
    expect(anchor.relList).toEqual(['noopener'])
  })

  test('does not repeat the guarantee the definition also asked for', async ({ page }) => {
    await page.setContent(
      documentFor(
        section(def({ rel: ['noopener', 'nofollow'], target: '_blank' }), { cta: { url: '/about', label: 'About' } }),
      ),
    )
    const anchor = await anchorOf(page)
    expect(anchor.rel).toBe('nofollow noopener')
    expect(anchor.relList).toEqual(['nofollow', 'noopener'])
  })

  test('adds it to an off-site link the definition said nothing about', async ({ page }) => {
    await page.setContent(documentFor(section(def(), { cta: { url: 'https://example.test/a', label: 'Out' } })))
    const anchor = await anchorOf(page)
    expect(anchor.relList).toEqual(['noopener'])
    expect(anchor.target).toBe('')
  })

  test('leaves a same-site link in this tab with no relationship at all', async ({ page }) => {
    await page.setContent(documentFor(section(def(), { cta: { url: '/about', label: 'About' } })))
    const anchor = await anchorOf(page)
    expect(anchor.rel).toBe('')
    expect(anchor.target).toBe('')
  })

  test('keeps the URL policy on the author’s value while the definition styles the anchor', async ({ page }) => {
    // The two sides of the boundary in one element. The definition chose the
    // class and the target; the author chose the destination, and the
    // destination went through the policy it always went through.
    await page.setContent(
      documentFor(
        section(def({ class: ['cta-button'], target: '_blank' }), {
          cta: { url: 'javascript:alert(1)', label: 'Trap' },
        }),
      ),
    )
    const anchor = await anchorOf(page)
    expect(anchor.href).toBe('#')
    expect(anchor.resolved.startsWith('javascript:')).toBe(false)
    expect(anchor.text).toBe('Trap')
  })
})

// ------------------------------------------------------------- nothing extra

test.describe('a page carrying every static attribute is still inert', () => {
  const everything = () =>
    structuredDef(
      [
        { name: 'cta', type: 'link', label: 'Call to action' },
        { name: 'picture', type: 'image', label: 'Picture' },
      ],
      [
        {
          type: 'element',
          tag: 'section',
          attributes: { class: 'card' },
          children: [
            {
              type: 'link',
              field: 'cta',
              staticAttributes: { class: ['cta-button'], rel: ['nofollow', 'noreferrer'], target: '_blank' },
            },
            {
              type: 'image',
              field: 'picture',
              staticAttributes: {
                class: ['media'],
                width: 640,
                height: 360,
                decoding: 'async',
                loading: 'lazy',
                fetchpriority: 'high',
              },
            },
          ],
        } as StructuredNode,
      ],
      '.cta-button{color:rgb(1, 2, 3)}.media{border:1px solid rgb(4, 5, 6)}',
    )

  test('emits exactly one anchor and one image, and nothing else', async ({ page }) => {
    await page.setContent(
      documentFor(
        section(everything(), {
          cta: { url: '/about', label: 'About' },
          picture: { src: '/pictures/harbour.png', alt: 'Boats in a harbour' },
        }),
      ),
    )
    expect(
      await page.evaluate(() => ({
        elements: Array.from(document.body.querySelectorAll('*')).map(e => e.tagName.toLowerCase()),
        anchorAttributes: Array.from(document.querySelector('a')!.attributes)
          .map(a => a.name)
          .sort(),
        imageAttributes: Array.from(document.querySelector('img')!.attributes)
          .map(a => a.name)
          .sort(),
      })),
    ).toEqual({
      elements: ['div', 'section', 'a', 'img'],
      anchorAttributes: ['class', 'href', 'rel', 'target'],
      imageAttributes: ['alt', 'class', 'decoding', 'fetchpriority', 'height', 'loading', 'src', 'width'],
    })
  })

  test('runs no script, fires no handler, opens no dialog and fetches nothing off-page', async ({ page }) => {
    for (const malicious of MALICIOUS_CASES) {
      // The corpus in the author's half of the element, with the definition's
      // half at its most generous. If a stored value could reach an attribute
      // this is where it would show.
      const observed = await observe(
        page,
        documentFor(
          section(everything(), {
            cta: { url: malicious.payload, label: malicious.payload },
            picture: { src: malicious.payload, alt: malicious.payload },
          }),
        ),
      )
      expectClean(observed, `${malicious.id} (${malicious.intent})`)
    }
  })

  test('puts nothing on the page at all when the definition asks for an attribute nobody listed', async ({ page }) => {
    // Refused whole rather than emitted without the offending attribute. A
    // section that renders without the class that lays it out is markup that
    // parses and looks wrong, and the visibly missing section is the one
    // somebody notices.
    for (const staticAttributes of [
      { style: 'background:url(//evil.test/x)' },
      { onclick: 'alert(1)' },
      { href: 'https://evil.test/' },
      { target: '_top' },
      { class: ['a" onclick="alert(1)'] },
    ]) {
      // Built without the compile assertion `structuredDef` makes, because the
      // whole point of these fixtures is that the compiler refuses them — and
      // the renderer has to refuse them again on its own, from the stored row,
      // rather than relying on the compiler having been asked.
      const def: SectionDefView = {
        section_def_id: 'd',
        version: 1,
        slug: SLUG,
        compiled_ast: NO_TEMPLATE,
        definition_kind: 'structured',
        structured_doc: {
          schemaVersion: STRUCTURED_SCHEMA_VERSION,
          fields: [{ name: 'cta', type: 'link', label: 'Call to action' }],
          nodes: [{ type: 'link', field: 'cta', staticAttributes }],
        },
        structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      }
      const html = renderSection(section(def, { cta: { url: '/about', label: 'About' } }), 0)
      expect(html, JSON.stringify(staticAttributes)).toBe('')
      await page.setContent(`<!doctype html><html><body>${html}</body></html>`)
      expect(await page.evaluate(() => document.body.querySelectorAll('*').length)).toBe(0)
    }
  })
})

// --------------------------------------------------------- preview and public

test.describe('preview and public put the same element on the page', () => {
  const def = structuredDef(
    [
      { name: 'cta', type: 'link', label: 'Call to action' },
      { name: 'picture', type: 'image', label: 'Picture' },
    ],
    [
      {
        type: 'link',
        field: 'cta',
        staticAttributes: { class: ['cta-button'], rel: ['nofollow'], target: '_blank' },
      } as StructuredNode,
      {
        type: 'image',
        field: 'picture',
        staticAttributes: { class: ['media'], width: 640, height: 360, loading: 'lazy' },
      } as StructuredNode,
    ],
    '.cta-button{color:rgb(1, 2, 3)}',
  )
  const values = {
    cta: { url: '/about', label: 'About' },
    picture: { src: '/pictures/harbour.png', alt: 'Boats in a harbour' },
  }

  /** Every element and attribute the parser found, with the editor's own removed. */
  const shapeOf = async (page: Page, html: string) => {
    await page.setContent(html)
    return page.evaluate(() => {
      for (const span of Array.from(document.querySelectorAll('cms-slot[data-cms-slot]'))) {
        span.replaceWith(...Array.from(span.childNodes))
      }
      const walk = (node: Element): string[] => {
        for (const attribute of Array.from(node.attributes)) {
          if (attribute.name.startsWith('data-cms-')) node.removeAttribute(attribute.name)
        }
        const own = `${node.tagName.toLowerCase()}[${Array.from(node.attributes)
          .map(a => `${a.name}=${a.value}`)
          .sort()
          .join('|')}]`
        return [own, ...Array.from(node.children).flatMap(walk)]
      }
      return Array.from(document.body.children).flatMap(walk)
    })
  }

  test('differ only by the instrumentation the editor selects on', async ({ page }) => {
    const built = section(def, values)
    const publicShape = await shapeOf(page, documentFor(built))
    const previewShape = await shapeOf(page, documentFor(built, true))
    expect(previewShape).toEqual(publicShape)
    // And the attributes really are there, so an equality between two empty
    // lists could never have satisfied this.
    expect(publicShape.join(' ')).toContain('rel=nofollow noopener')
    expect(publicShape.join(' ')).toContain('width=640')
  })

  test('applies the definition’s stylesheet in preview too', async ({ page }) => {
    await page.setContent(documentFor(section(def, values), true))
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('a')!).color)).toBe('rgb(1, 2, 3)')
  })
})
