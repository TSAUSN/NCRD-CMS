import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
import { renderSection } from '../../renderer/src/render.ts'
import { compileSection } from '../../renderer/src/compile.ts'

let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('frame-public-media')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

async function media(siteId: string | null = null) {
  const id = randomUUID()
  await db.as('owner', async client => {
    await client.query(
      `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status)
      VALUES($1,$2,$3,$4,'frame.jpg','Frame',10,10,100,'image/jpeg','ready')`,
      [id, siteId, `frame-test/${id}.jpg`, id.replaceAll('-', '').padEnd(64, 'a')],
    )
    await client.query(
      `INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type)
      VALUES($1,'wide',$2,$3,10,10,80,'image/webp')`,
      [id, `frame-test/${id}.webp`, id.replaceAll('-', '').padEnd(64, 'b')],
    )
  })
  return id
}
const slots = [
  { id: 'picture', kind: 'image', label: 'Picture', constraints: {} },
  { id: 'body', kind: 'richtext', label: 'Body', constraints: {} },
  { id: 'menu', kind: 'navigation', label: 'Menu', constraints: {} },
]
async function definition(
  slug: string,
  kind: 'header' | 'footer',
  staticMedia: string,
  cssMedia?: string,
  options: {
    site?: string
    trusted?: boolean
    rawOnlyMedia?: string
    ast?: unknown
    slots?: unknown
    document?: unknown
    css?: string
  } = {},
) {
  const html = `<div><img src="/media/${staticMedia}/wide" alt="Static">{{picture}}{{body}}<nav>{{menu}}</nav></div>`
  const ast = {
    policyVersion: 4,
    cssPolicyVersion: 6,
    nodes: [
      { kind: 'html', value: `<div><img src="/media/${staticMedia}/wide" alt="Static">` },
      { kind: 'slot', slotId: 'picture', slotKind: 'image', context: 'element-text' },
      { kind: 'slot', slotId: 'body', slotKind: 'richtext', context: 'element-text' },
      { kind: 'html', value: '<nav>' },
      { kind: 'slot', slotId: 'menu', slotKind: 'navigation', context: 'element-text' },
      { kind: 'html', value: '</nav></div>' },
    ],
  }
  const css = `.cms-section--${slug}{${cssMedia ? `background-image:url("/media/${cssMedia}/wide")` : 'display:block'}}`
  return db.asUser(s.superAdmin, async client => {
    const row = (
      await client.query<{ section_def_id: string; version: number }>(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          slug,
          slug,
          'Frame',
          html + (options.rawOnlyMedia ? `<!-- /media/${options.rawOnlyMedia}/wide -->` : ''),
          css,
          options.css ?? css,
          JSON.stringify(options.ast ?? ast),
          JSON.stringify(options.slots ?? slots),
          `hash-${slug}`,
          (options.ast as { policyVersion?: number })?.policyVersion ?? 4,
          6,
          'Synthetic fixture',
          options.trusted ?? false,
          options.document ? 'structured' : 'legacy',
          options.document ? JSON.stringify(options.document) : null,
          options.document ? 3 : null,
          options.site ? 'site' : 'global',
          options.site ?? null,
        ],
      )
    ).rows[0]!
    await client.query('SELECT app.set_section_def_placement($1,$2)', [row.section_def_id, kind])
    return row
  })
}
function frame(
  kind: 'header' | 'footer',
  def: { section_def_id: string; version: number },
  values: Record<string, unknown> = {},
  enabled = true,
) {
  return {
    schemaVersion: 2,
    enabled,
    ...(kind === 'header' ? { sticky: false } : {}),
    component: { section_def_id: def.section_def_id, section_def_version: def.version, values },
  }
}
async function save(header?: unknown, footer?: unknown, publish = false) {
  return db.asUser(s.superAdmin, async client => {
    const heads = (
      await client.query(
        `SELECT g.kind,g.revision,v.content FROM global_elements g
      JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1`,
        [s.siteA],
      )
    ).rows
    const h = heads.find(row => row.kind === 'header')!,
      f = heads.find(row => row.kind === 'footer')!
    const saved = (
      await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        s.siteA,
        h.revision,
        f.revision,
        JSON.stringify(header ?? h.content),
        JSON.stringify(footer ?? f.content),
      ])
    ).rows[0]!
    if (publish)
      await client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
        s.siteA,
        saved.header_revision,
        saved.footer_revision,
      ])
    return saved
  })
}
const resolve = (id: string, host = 'site-a.staging.example.test', variant = 'wide') =>
  db.as(
    'public',
    async client =>
      (await client.query('SELECT media_id FROM public_api.resolve_media($1,$2,$3)', [host, id, variant])).rows,
  )
const expectPublic = async (id: string) => expect(await resolve(id)).toEqual([{ media_id: id }])
const expectPrivate = async (id: string) => expect(await resolve(id)).toEqual([])
// Cross-check the SQL delivery decision against the same renderer used by
// the published frame, not another hand-written interpretation in this test.
async function renderedHeader() {
  const row = (
    await db.as('owner', client =>
      client.query(
        `SELECT
    app.global_component_view(g.site_id,g.kind,v.content) AS def, v.content->'component' AS instance
    FROM global_elements g JOIN global_element_versions v ON v.id=g.published_version_id
    WHERE g.site_id=$1 AND g.kind='header'`,
        [s.siteA],
      ),
    )
  ).rows[0]!
  if (!row.def) return ''
  return renderSection(row as Parameters<typeof renderSection>[0], 0)
}

describe('public delivery of authored-frame shared media', () => {
  it('serves the exact published header/footer source and values, excluding other sites and ignored content', async () => {
    const [staticImage, valueImage, richtextImage, cssImage, footerImage, rawOnly, ignored, unrelated] =
      await Promise.all(Array.from({ length: 8 }, () => media()))
    const h = await definition(`header-${randomUUID().slice(0, 8)}`, 'header', staticImage!, cssImage, {
      rawOnlyMedia: rawOnly,
    })
    const f = await definition(`footer-${randomUUID().slice(0, 8)}`, 'footer', footerImage!)
    const header = frame('header', h, {
      picture: { src: `/media/${valueImage}/wide`, media_id: valueImage, variant: 'wide', alt: 'Logo' },
      body: `<p><a href="/media/${richtextImage}/wide">Partner picture</a></p>`,
      menu: `/media/${ignored}/wide`,
      undeclared: { src: `/media/${ignored}/wide`, media_id: ignored },
    })
    await save(header, frame('footer', f))
    for (const id of [staticImage, valueImage, richtextImage, cssImage, footerImage]) await expectPrivate(id!)
    await save(undefined, undefined, true)
    for (const id of [staticImage, valueImage, richtextImage, cssImage, footerImage]) {
      await expectPublic(id!)
      expect(await resolve(id!, 'site-b.staging.example.test')).toEqual([])
    }
    expect(await renderedHeader()).toContain(`href="/media/${richtextImage}/wide"`)
    for (const id of [rawOnly, ignored, unrelated]) await expectPrivate(id!)
    expect(await resolve(staticImage!, 'unknown.example.test')).toEqual([])
    expect(await resolve(staticImage!, 'site-a.staging.example.test', 'thumbnail')).toEqual([])
  })

  it('does not publish inert metadata, text, stripped rich-text images, or declared but unbound values', async () => {
    const [staticImage, metaOnly, textObject, textAddress, stripped, unused, labelOnly, external] = await Promise.all(
      Array.from({ length: 8 }, () => media()),
    )
    const h = await definition(`sinks-${randomUUID().slice(0, 8)}`, 'header', staticImage!, undefined, {
      slots: [
        ...slots,
        { id: 'title', kind: 'text', label: 'Title', constraints: {} },
        { id: 'caption', kind: 'text', label: 'Caption', constraints: {} },
        { id: 'unused', kind: 'image', label: 'Unused', constraints: {} },
        { id: 'link', kind: 'link', label: 'Link', constraints: {} },
        { id: 'external', kind: 'image', label: 'External', constraints: {} },
      ],
      ast: {
        policyVersion: 4,
        cssPolicyVersion: 6,
        nodes: [
          { kind: 'html', value: `<div><img src="/media/${staticImage}/wide">` },
          ...[
            ['picture', 'image'],
            ['body', 'richtext'],
            ['title', 'text'],
            ['caption', 'text'],
            ['link', 'link'],
            ['external', 'image'],
          ].map(([slotId, slotKind]) => ({ kind: 'slot', slotId, slotKind, context: 'element-text' })),
          { kind: 'html', value: '</div>' },
        ],
      },
    })
    await save(
      frame('header', h, {
        picture: { src: '/brand.svg', media_id: metaOnly, alt: `/media/${metaOnly}/wide` },
        title: { media_id: textObject, src: `/media/${textObject}/wide` },
        caption: `/media/${textAddress}/wide`,
        body: `<p><img src="/media/${stripped}/wide"></p>`,
        unused: { src: `/media/${unused}/wide` },
        link: { url: '/about', label: `/media/${labelOnly}/wide` },
        external: { src: `https://other.test/media/${external}/wide` },
      }),
      undefined,
      true,
    )
    const rendered = await renderedHeader()
    expect(rendered).toContain(`src="/media/${staticImage}/wide"`)
    expect(rendered).not.toContain(stripped!)
    expect(rendered).not.toContain(textObject!)
    expect(rendered).not.toContain(unused!)
    await expectPublic(staticImage!)
    for (const id of [metaOnly, textObject, textAddress, stripped, unused, labelOnly, external])
      await expectPrivate(id!)
  })

  it('only publishes rendered structured image/link fields, not unused values, text or image metadata', async () => {
    const [image, linked, unused, text, metadata, noAlt, emptyLink, arrayLabel] = await Promise.all(
      Array.from({ length: 8 }, () => media()),
    )
    const fields = [
      ['picture', 'image'],
      ['link', 'link'],
      ['unused', 'image'],
      ['title', 'text'],
      ['noAlt', 'image'],
      ['emptyLink', 'link'],
      ['arrayLabel', 'link'],
    ]
    const h = await definition(`structured-${randomUUID().slice(0, 8)}`, 'header', randomUUID(), undefined, {
      ast: { policyVersion: 4, cssPolicyVersion: 6, nodes: [] },
      slots: fields.map(([id, kind]) => ({ id, kind, label: id, constraints: {} })),
      document: {
        schemaVersion: 3,
        fields: fields.map(([name, type]) => ({ name, type, label: name })),
        nodes: [
          {
            type: 'element',
            tag: 'div',
            children: fields.filter(([field]) => field !== 'unused').map(([field, type]) => ({ field, type })),
          },
        ],
      },
    })
    await save(
      frame('header', h, {
        picture: { src: `/media/${image}/wide`, media_id: metadata, alt: 'Logo' },
        link: { url: `/media/${linked}/original`, label: 'Download' },
        unused: { src: `/media/${unused}/wide`, alt: 'Unused' },
        title: { media_id: text, src: `/media/${text}/wide` },
        noAlt: { src: `/media/${noAlt}/wide` },
        emptyLink: { url: `/media/${emptyLink}/wide`, label: '' },
        arrayLabel: { url: `/media/${arrayLabel}/wide`, label: [] },
      }),
      undefined,
      true,
    )
    const rendered = await renderedHeader()
    expect(rendered).toContain(`src="/media/${image}/wide"`)
    expect(rendered).toContain(`href="/media/${linked}/original"`)
    for (const id of [unused, text, metadata, noAlt, emptyLink, arrayLabel]) expect(rendered).not.toContain(id!)
    await expectPublic(image!)
    expect(await resolve(linked!, 'site-a.staging.example.test', 'original')).toEqual([{ media_id: linked }])
    await expectPrivate(linked!)
    for (const id of [unused, text, metadata, noAlt, emptyLink, arrayLabel]) await expectPrivate(id!)
  })

  it('does not mistake static text, arbitrary attributes, or CSS string contents for media references', async () => {
    const [image, text, title, cssString, comment, inert, duplicate] = await Promise.all(
      Array.from({ length: 7 }, () => media()),
    )
    const slug = `static-${randomUUID().slice(0, 8)}`
    const h = await definition(slug, 'header', image!, undefined, {
      slots: [],
      ast: {
        policyVersion: 4,
        cssPolicyVersion: 6,
        nodes: [
          {
            kind: 'html',
            value: `<div title='/media/${title}/wide'>/media/${text}/wide<img src="/media/${image}/wide" src="/media/${duplicate}/wide"></div><!-- <img src="/media/${comment}/wide"> --><textarea><img src="/media/${inert}/wide"></textarea>`,
          },
        ],
      },
      css: `.cms-section--${slug}::after{content:'url(/media/${cssString}/wide)'}`,
    })
    await save(frame('header', h), undefined, true)
    await expectPublic(image!)
    for (const id of [text, title, cssString, comment, inert, duplicate]) await expectPrivate(id!)
  })

  it('supports policy-5 typed URL bindings without exposing an alt-only image binding', async () => {
    const [image, linked, altOnly] = await Promise.all(Array.from({ length: 3 }, () => media()))
    const h = await definition(`typed-${randomUUID().slice(0, 8)}`, 'header', randomUUID(), undefined, {
      slots: [
        slots[0],
        { id: 'link', kind: 'link', label: 'Link', constraints: {} },
        { id: 'caption', kind: 'image', label: 'Caption', constraints: {} },
      ],
      ast: {
        policyVersion: 5,
        cssPolicyVersion: 6,
        nodes: [
          { kind: 'html', value: '<a href="' },
          { kind: 'slot', slotId: 'link', slotKind: 'link', context: 'url-attribute', attribute: 'href' },
          { kind: 'html', value: '"><img src="' },
          { kind: 'slot', slotId: 'picture', slotKind: 'image', context: 'url-attribute', attribute: 'src' },
          { kind: 'html', value: '" alt="' },
          { kind: 'slot', slotId: 'caption', slotKind: 'image', context: 'quoted-attribute', attribute: 'alt' },
          { kind: 'html', value: '"></a>' },
        ],
      },
    })
    await save(
      frame('header', h, {
        picture: { src: `/media/${image}/wide`, alt: 'Logo' },
        link: { url: `/media/${linked}/original`, label: 'Download' },
        caption: { src: `/media/${altOnly}/wide`, media_id: altOnly, alt: 'Caption' },
      }),
      undefined,
      true,
    )
    const rendered = await renderedHeader()
    expect(rendered).toContain(`src="/media/${image}/wide"`)
    expect(rendered).toContain(`href="/media/${linked}/original"`)
    expect(rendered).not.toContain(altOnly!)
    await expectPublic(image!)
    expect(await resolve(linked!, 'site-a.staging.example.test', 'original')).toEqual([{ media_id: linked }])
    await expectPrivate(linked!)
    await expectPrivate(altOnly!)
  })

  it('requires an active tag/attribute pair for static and typed URL bindings', async () => {
    const [image, inertHref, inertSrc, typedSrc, typedHref] = await Promise.all(
      Array.from({ length: 5 }, () => media()),
    )
    const fieldSlots = [
      { id: 'picture', kind: 'image' as const, label: 'Picture', constraints: {} },
      { id: 'link', kind: 'link' as const, label: 'Link', constraints: {} },
    ]
    const compiled = compileSection({
      sourceHtml: `<div href="/media/${inertHref}/wide"><span src="/media/${inertSrc}/wide"></span><a src="{{picture}}">Inert image</a><div href="{{link}}">Inert link</div><img src="/media/${image}/wide"></div>`,
      slots: fieldSlots,
    })
    expect(compiled.blocking).toEqual([])
    const h = await definition(`tag-sinks-${randomUUID().slice(0, 8)}`, 'header', image!, undefined, {
      ast: compiled.ast,
      slots: fieldSlots,
    })
    await save(
      frame('header', h, {
        picture: { src: `/media/${typedSrc}/wide`, alt: 'Image' },
        link: { url: `/media/${typedHref}/wide`, label: 'Link' },
      }),
      undefined,
      true,
    )
    const rendered = await renderedHeader()
    // The compiler/renderer accept these attributes, but browsers do not use
    // div.href, span.src or a.src to load/navigate to the named resource.
    expect(rendered).toContain(`<a src="/media/${typedSrc}/wide">`)
    expect(rendered).toContain(`<div href="/media/${typedHref}/wide">`)
    await expectPublic(image!)
    for (const id of [inertHref, inertSrc, typedSrc, typedHref]) await expectPrivate(id!)
  })

  it('ignores malformed static srcset candidates and rejected dynamic URL lists', async () => {
    const [image, malformed, dynamic] = await Promise.all(Array.from({ length: 3 }, () => media()))
    const fieldSlots = [{ id: 'sources', kind: 'text' as const, label: 'Sources', constraints: {} }]
    const compiled = compileSection({
      sourceHtml: `<picture><source srcset="/media/${image}/wide 2x"><img srcset="/media/${malformed}/wide too many parts"><img srcset="{{sources}}"></picture>`,
      slots: fieldSlots,
    })
    expect(compiled.blocking).toEqual([])
    const h = await definition(`source-lists-${randomUUID().slice(0, 8)}`, 'header', image!, undefined, {
      ast: compiled.ast,
      slots: fieldSlots,
    })
    await save(frame('header', h, { sources: `/media/${dynamic}/wide 1x, //other.test/a.jpg 2x` }), undefined, true)
    expect(await renderedHeader()).not.toContain(dynamic!)
    await expectPublic(image!)
    await expectPrivate(malformed!)
    await expectPrivate(dynamic!)
    await save(frame('header', h, { sources: `/media/${dynamic}/wide 1x, /media/${image}/wide 2x` }), undefined, true)
    expect(await renderedHeader()).toContain(`/media/${dynamic}/wide 1x`)
    await expectPublic(dynamic!)
  })

  it('does not expose a frame whose stored AST misstates the actual slot context', async () => {
    const image = await media(),
      css = await media()
    const h = await definition(`mismatch-${randomUUID().slice(0, 8)}`, 'header', randomUUID(), css, {
      ast: {
        policyVersion: 4,
        cssPolicyVersion: 6,
        nodes: [
          { kind: 'html', value: '<div title="' },
          { kind: 'slot', slotId: 'picture', slotKind: 'image', context: 'element-text' },
          { kind: 'html', value: '">Frame</div>' },
        ],
      },
    })
    await save(frame('header', h, { picture: { src: `/media/${image}/wide`, alt: 'Image' } }), undefined, true)
    expect(await renderedHeader()).toBe('')
    await expectPrivate(image)
    await expectPrivate(css)
  })

  it('does not expose siblings or item templates of an unresolved structured repeat', async () => {
    const image = await media(),
      css = await media()
    const h = await definition(`repeat-${randomUUID().slice(0, 8)}`, 'header', randomUUID(), css, {
      ast: { policyVersion: 4, cssPolicyVersion: 6, nodes: [] },
      slots: [
        { id: 'picture', kind: 'image', label: 'Image', constraints: {} },
        { id: 'items', kind: 'repeat', label: 'Items', constraints: {} },
      ],
      document: {
        schemaVersion: 3,
        fields: [
          { name: 'picture', type: 'image', label: 'Image' },
          { name: 'items', type: 'repeat', label: 'Items' },
        ],
        nodes: [
          { type: 'image', field: 'picture' },
          { type: 'repeat', field: 'items', empty: { behavior: 'hide' }, item: [{ type: 'image', field: 'photo' }] },
        ],
      },
    })
    const saved = await save(frame('header', h, { picture: { src: `/media/${image}/wide`, alt: 'Image' } }))
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
          s.siteA,
          saved.header_revision,
          saved.footer_revision,
        ]),
      ),
      'CMS04',
    )
    await db.as('owner', client =>
      client.query("UPDATE global_elements SET published_version_id=$2 WHERE site_id=$1 AND kind='header'", [
        s.siteA,
        saved.header_version_id,
      ]),
    )
    expect(await renderedHeader()).toBe('')
    await expectPrivate(image)
    await expectPrivate(css)
  })

  it('keeps generic document matching confined to link sinks and internal callers', async () => {
    const document = randomUUID(),
      imageOnly = randomUUID()
    const hash = 'a'.repeat(64)
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        s.siteA,
        document,
        'document',
        `site-assets/${s.siteA}/${document}/${hash}`,
        'application/pdf',
        99,
        hash,
        'frame.pdf',
        null,
        JSON.stringify({ path: 'documents/frame.pdf', sha256: hash, manifest_sha256: hash }),
      ]),
    )
    const h = await definition(`documents-${randomUUID().slice(0, 8)}`, 'header', await media())
    await save(
      frame('header', h, {
        picture: { src: `/assets/${imageOnly}`, alt: 'Invalid image' },
        body: `<p><a href="/assets/${document}">Download</a></p>`,
      }),
      undefined,
      true,
    )
    const used = (id: string) =>
      db.as(
        'owner',
        async client =>
          (
            await client.query<{ used: boolean }>('SELECT app.published_frame_uses_url_pattern($1,$2,true) AS used', [
              s.siteA,
              `^/assets/${id}([?#][^[:space:]]*)?$`,
            ])
          ).rows[0]!.used,
      )
    expect(await used(document)).toBe(true)
    expect(await used(imageOnly)).toBe(false)
    const staticOnly = await definition(
      `document-comment-${randomUUID().slice(0, 8)}`,
      'header',
      randomUUID(),
      undefined,
      {
        slots: [],
        ast: {
          policyVersion: 4,
          cssPolicyVersion: 6,
          nodes: [{ kind: 'html', value: `<!-- <a href="/assets/${document}">Hidden</a> --><p>Frame</p>` }],
        },
      },
    )
    await save(frame('header', staticOnly), undefined, true)
    expect(await used(document)).toBe(false)
    const unquotedHtml = `<a href=/assets/${document}>Download</a>`
    const compiled = compileSection({ sourceHtml: unquotedHtml, slots: [] })
    expect(compiled.blocking).toEqual([])
    const staticLink = await definition(
      `document-unquoted-${randomUUID().slice(0, 8)}`,
      'header',
      randomUUID(),
      undefined,
      { slots: [], ast: compiled.ast },
    )
    await save(frame('header', staticLink), undefined, true)
    expect(await renderedHeader()).toContain(unquotedHtml)
    expect(await used(document)).toBe(true)
  })

  it('keeps old published pins until deliberate publication, without exposing newer versions or draft values', async () => {
    const [oldStatic, nextStatic, oldValue, nextValue] = await Promise.all(Array.from({ length: 4 }, () => media()))
    const slug = `pins-${randomUUID().slice(0, 8)}`
    const v1 = await definition(slug, 'header', oldStatic!)
    await save(frame('header', v1, { picture: { src: `/media/${oldValue}/wide` } }), undefined, true)
    const v2 = await definition(slug, 'header', nextStatic!)
    await save(frame('header', v2, { picture: { src: `/media/${nextValue}/wide` } }))
    await expectPublic(oldStatic!)
    await expectPublic(oldValue!)
    await expectPrivate(nextStatic!)
    await expectPrivate(nextValue!)
    await save(undefined, undefined, true)
    await expectPublic(nextStatic!)
    await expectPublic(nextValue!)
    await expectPrivate(oldStatic!)
    await expectPrivate(oldValue!)
  })

  it('keeps retired pins working but revokes access for disabled or replaced frames', async () => {
    const image = await media(),
      h = await definition(`retired-${randomUUID().slice(0, 8)}`, 'header', image)
    await save(frame('header', h), undefined, true)
    await db.asUser(s.superAdmin, client =>
      client.query("SELECT app.set_frame_definition_status($1,'retired')", [h.section_def_id]),
    )
    await expectPublic(image)
    await save(frame('header', h, {}, false), undefined, true)
    await expectPrivate(image)
    await save(frame('header', h), undefined, true)
    await expectPublic(image)
    const preset = (
      await db.as('owner', client => client.query("SELECT app.default_header_content('Preset') AS content"))
    ).rows[0]!.content
    await save(preset, undefined, true)
    await expectPrivate(image)
  })

  it('still refuses foreign, deleted and missing media even when a published frame names it', async () => {
    const foreign = await media(s.siteB),
      image = await media(),
      missing = randomUUID()
    const h = await definition(`readiness-${randomUUID().slice(0, 8)}`, 'header', foreign)
    const saved = await save(
      frame('header', h, { picture: { src: `/media/${image}/wide` }, body: `/media/${missing}/wide` }),
    )
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
          s.siteA,
          saved.header_revision,
          saved.footer_revision,
        ]),
      ),
      'CMS04',
    )
    // The normal command now refuses this broken frame. Delivery must still
    // fail closed if an operator corrupts a pointer outside that command.
    await db.as('owner', client =>
      client.query("UPDATE global_elements SET published_version_id=$2 WHERE site_id=$1 AND kind='header'", [
        s.siteA,
        saved.header_version_id,
      ]),
    )
    await expectPrivate(foreign)
    await expectPrivate(missing)
    await expectPublic(image)
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT app.soft_delete_media($1,1,true,$2)', [image, 'Synthetic delivery test']),
    )
    await expectPrivate(image)
  })

  it.each(['foreign', 'misplaced', 'trusted'] as const)(
    'does not grant access through a %s definition even if a published pointer is corrupted',
    async condition => {
      const image = await media()
      const h = await definition(
        `invalid-${condition}-${randomUUID().slice(0, 8)}`,
        condition === 'misplaced' ? 'footer' : 'header',
        image,
        undefined,
        { ...(condition === 'foreign' ? { site: s.siteB } : {}), trusted: condition === 'trusted' },
      )
      const saved = await save(frame('header', h))
      await db.as('owner', client =>
        client.query("UPDATE global_elements SET published_version_id=$2 WHERE site_id=$1 AND kind='header'", [
          s.siteA,
          saved.header_version_id,
        ]),
      )
      await expectPrivate(image)
    },
  )

  it('keeps the internal reference helper inaccessible to public and authenticated roles', async () => {
    for (const role of ['public', 'authenticated'] as const) {
      await expectSqlState(
        db.as(role, client => client.query('SELECT app.frame_srcset_is_safe($1)', ['/a.jpg 1x'])),
        '42501',
      )
      await expectSqlState(
        db.as(role, client => client.query('SELECT app.frame_ast_bindings_match($1)', [{ nodes: [] }])),
        '42501',
      )
      await expectSqlState(
        db.as(role, client =>
          client.query('SELECT app.published_frame_uses_url_pattern($1,$2)', [s.siteA, '^/assets/unused$']),
        ),
        '42501',
      )
      await expectSqlState(
        db.as(role, client => client.query('SELECT app.published_frame_uses_media($1,$2)', [s.siteA, randomUUID()])),
        '42501',
      )
      for (const helper of ['frame_url_matches', 'frame_css_uses_url_pattern', 'frame_markup_uses_url_pattern']) {
        await expectSqlState(
          db.as(role, client => client.query(`SELECT app.${helper}($1,$2)`, ['', randomUUID()])),
          '42501',
        )
      }
    }
  })
})

it('delivers an opted-in inherited footer logo with a disabled header, preserving draft and site isolation', async () => {
  const [staticImage, logo, nextLogo, ownLogo, foreign] = await Promise.all([
    media(),
    media(),
    media(),
    media(),
    media(s.siteB),
  ])
  const h = await definition('inherit-header-' + randomUUID().slice(0, 8), 'header', staticImage!, undefined, {
    slots: [{ ...slots[0], constraints: { siteLogo: true } }],
  })
  const f = await definition('inherit-footer-' + randomUUID().slice(0, 8), 'footer', staticImage!, undefined, {
    slots: [{ ...slots[0], constraints: { inheritHeaderLogo: true } }],
  })
  const image = (id: string) => ({ src: '/media/' + id + '/wide', media_id: id, variant: 'wide', alt: '[Site logo]' })
  await save(frame('header', h, { picture: image(logo!) }, false), frame('footer', f))
  await expectPrivate(logo!)
  const uses = await db.as('owner', client =>
    client.query(
      "SELECT u.version_id FROM media_usage u JOIN global_elements g ON g.id=u.item_id WHERE u.media_id=$1 AND g.kind='footer'",
      [logo],
    ),
  )
  expect(uses.rows.length).toBeGreaterThan(0)
  await save(undefined, undefined, true)
  await expectPublic(logo!)
  expect(await resolve(logo!, 'site-b.staging.example.test')).toEqual([])
  await save(frame('header', h, { picture: image(nextLogo!) }, false))
  await expectPublic(logo!)
  await expectPrivate(nextLogo!)
  await save(undefined, undefined, true)
  await expectPrivate(logo!)
  await expectPublic(nextLogo!)
  await save(undefined, frame('footer', f, { picture: image(ownLogo!) }), true)
  await expectPublic(ownLogo!)
  await expectPrivate(nextLogo!)
  await save(frame('header', h, { picture: image(foreign!) }, false), frame('footer', f))
  await expectSqlState(save(undefined, undefined, true), 'CMS04')
  await expectPrivate(foreign!)
})
