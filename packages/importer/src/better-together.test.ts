import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { BT_NO_SCRIPT_CSS, importBetterTogetherHomepage } from './better-together.ts'
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bt-home-'))
  folders.push(root)
  for (const dir of ['css', 'images', 'js', 'cache']) mkdirSync(join(root, dir))
  writeFileSync(
    join(root, 'images', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M0 0h20v20H0z"/></svg>',
  )
  writeFileSync(
    join(root, 'css', 'home.css'),
    '@keyframes pulse{from{opacity:.5}to{opacity:1}}.hero:hover{transform:scale(1.01);transition:transform .2s}@media(max-width:600px){.hero{padding:8px}}',
  )
  const js = 'document.documentElement.dataset.proof="ready"',
    hash = createHash('sha256').update(js).digest('hex'),
    cache = join(root, 'cache')
  writeFileSync(join(cache, hash + '.bin'), js)
  writeFileSync(
    join(cache, 'receipts.json'),
    JSON.stringify([
      {
        source: 'https://cdn.example.test/home.js',
        final: 'https://cdn.example.test/home.js',
        file: hash + '.bin',
        hash,
        bytes: Buffer.byteLength(js),
        type: 'text/javascript',
      },
    ]),
  )
  const html =
    '<html lang="en"><head><link rel="stylesheet" href="css/home.css"></head><body data-bs-spy="scroll"><nav class="navbar"><a href="#header">Welcome</a></nav><header id="header" class="hero"><h1>Fish &amp; chips</h1><img src="http://bettertogether2027.org/images/logo.svg" alt="Event"><button data-bs-toggle="modal" data-bs-target="#details">Read more</button><style>.hero{color:navy}</style></header><div id="details" class="modal fade"><p>Readable without JavaScript.</p></div><div class="footer"><p>Contact us</p></div><script src="https://cdn.example.test/home.js"></script><script>window.originalBehavior=true;</script></body></html>'
  return { root, cache, html, hash }
}
describe('BT2027 homepage-only offline import', () => {
  it('preserves actual roots, classes, data attributes and readable source content with editable fields', () => {
    const f = fixture(),
      { archive, report } = importBetterTogetherHomepage(f),
      c = archive.content,
      bundle = c.site_file_versions![0]!.bundle
    expect(c.pages).toHaveLength(1)
    expect(c.pages[0]!.slug).toBe('')
    expect(c.section_defs.filter(d => d.placement === 'header')).toHaveLength(1)
    const hero = c.section_def_versions.find(v => v.source_html.startsWith('<header'))!
    expect(hero.source_html).toContain('id="header" class="hero"')
    expect(hero.source_html).toContain('data-bs-toggle="modal" data-bs-target="#details"')
    expect(hero.source_html).not.toMatch(/cms-site-root|<script|<style/)
    expect(c.page_versions[0]!.content[0]!.values).toMatchObject({
      'text-0': 'Fish & chips',
      'picture-1': { src: '/images/logo.svg', alt: 'Event' },
    })
    expect(bundle.original!.definitions).toHaveLength(4)
    expect(bundle.original!.pages[0]).toMatchObject({ body: { 'data-bs-spy': 'scroll' }, header: true, footer: true })
    expect(report.reduce((n, r) => n + r.images, 0)).toBe(1)
    expect(c.section_def_versions.every(v => v.source_css === '')).toBe(true)
  })
  it('keeps cascade order, keyframes, transitions and media queries in reviewed styles; externalizes behavior in order', () => {
    const f = fixture(),
      { archive } = importBetterTogetherHomepage(f),
      bundle = archive.content.site_file_versions![0]!.bundle
    const bytes = (id: string) => Buffer.from(archive.objects.find(o => o.media_id === id)!.base64, 'base64').toString()
    expect(bundle.styles.map(s => bytes(s.fileId))).toEqual([
      expect.stringContaining('@keyframes pulse'),
      '.hero{color:navy}',
      BT_NO_SCRIPT_CSS,
    ])
    expect(bytes(bundle.styles[0]!.fileId)).toContain('@media(max-width:600px)')
    expect(bytes(bundle.styles[0]!.fileId)).toContain('transition:transform .2s')
    expect(bundle.scripts.map(s => bytes(s.fileId))).toEqual([
      'document.documentElement.dataset.proof="ready"',
      'window.originalBehavior=true;',
    ])
    expect(archive.content.site_files!.find(file => file.sha256 === f.hash)?.source).toBe(
      'https://cdn.example.test/home.js',
    )
  })
  it('imports only the eight allowed marketing pages with their own frame and owned navigation', () => {
    const f = fixture(),
      r = importBetterTogetherHomepage({
        ...f,
        page: 'hotel-information.php',
        title: 'Hotel information',
        html: f.html.replace('href="#header"', 'href="index.php#header"'),
      }),
      c = r.archive.content
    expect(c.pages[0]).toMatchObject({ slug: 'hotel-information', title: 'Hotel information' })
    expect(c.page_versions[0]!.content).toHaveLength(4)
    expect(c.section_def_versions[0]!.source_html).toContain('href="/#header"')
    expect(c.site_file_versions![0]!.bundle.original!.pages[0]).toMatchObject({ header: false, footer: false })
    expect(c.site_files!.some(file => file.name.startsWith('hotel-information-inline-'))).toBe(true)
    expect(() => importBetterTogetherHomepage({ ...f, page: 'dashboard.php' as never })).toThrow(/marketing page/)
  })
  it('preserves authored page metadata and keeps a useful CMS page name', () => {
    const f = fixture(),
      c = importBetterTogetherHomepage({
        ...f,
        page: 'workshops.html',
        title: 'Workshops',
        html: f.html.replace(
          '<head>',
          '<head><title>Better Together 2023</title><meta name="description" content="Original workshop guide">',
        ),
      }).archive.content
    expect(c.pages[0]!.title).toBe('Workshops')
    expect(c.page_versions[0]!.meta).toMatchObject({
      title: 'Better Together 2023',
      description: 'Original workshop guide',
    })
  })
  it('keeps the workshop submission application at its source address without importing or fetching it', () => {
    const f = fixture(),
      c = importBetterTogetherHomepage({
        ...f,
        html: f.html.replace('<h1>', '<a href="/workshop-submissions.html">Submit a workshop</a><h1>'),
      }).archive.content
    expect(
      c.section_def_versions.some(version =>
        version.source_html.includes('href="https://bettertogether2027.org/workshop-submissions.html"'),
      ),
    ).toBe(true)
    expect(c.pages).toHaveLength(1)
    expect(c.site_files!.some(file => /workshop-submissions/.test(file.source))).toBe(false)
  })
  it('records an old document mode instead of silently changing table layout', () => {
    const f = fixture()
    expect(
      importBetterTogetherHomepage({ ...f, page: 'workshops.html', html: f.html }).archive.content
        .site_file_versions![0]!.bundle.original!.pages[0]!.quirks,
    ).toBe(true)
    expect(
      importBetterTogetherHomepage({ ...f, html: '<!doctype html>' + f.html }).archive.content.site_file_versions![0]!
        .bundle.original!.pages[0]!.quirks,
    ).toBeUndefined()
  })
  it('rejects changed cache bytes and missing script dependencies instead of silently losing behavior', () => {
    const f = fixture()
    writeFileSync(join(f.cache, f.hash + '.bin'), 'changed')
    expect(() => importBetterTogetherHomepage(f)).toThrow(/do not match/)
    const next = fixture()
    expect(() =>
      importBetterTogetherHomepage({
        ...next,
        html: next.html.replace('cdn.example.test/home.js', 'other.example.test/home.js'),
      }),
    ).toThrow(/script is missing/)
  })
  it('refuses inline handlers and referenced files or cache symlinks escaping the chosen folders', () => {
    const f = fixture()
    expect(() =>
      importBetterTogetherHomepage({ ...f, html: f.html.replace('<h1>', '<h1 onclick="alert(1)">') }),
    ).toThrow(/Inline event/)
    const external = fixture()
    rmSync(join(f.root, 'images', 'logo.svg'))
    symlinkSync(join(external.root, 'images', 'logo.svg'), join(f.root, 'images', 'logo.svg'))
    expect(() => importBetterTogetherHomepage(f)).toThrow(/escapes/)
    const g = fixture()
    rmSync(join(g.cache, g.hash + '.bin'))
    symlinkSync(join(external.cache, external.hash + '.bin'), join(g.cache, g.hash + '.bin'))
    expect(() => importBetterTogetherHomepage(g)).toThrow(/cache file escapes/)
  })
  it('records unavailable offline pictures without making runtime third-party image requests', () => {
    const f = fixture(),
      r = importBetterTogetherHomepage({
        ...f,
        html: f.html.replace(
          'http://bettertogether2027.org/images/logo.svg',
          'https://pictures.example.test/missing.jpg',
        ),
      })
    expect(r.omitted).toEqual(['https://pictures.example.test/missing.jpg'])
    expect(r.archive.content.page_versions[0]!.content[0]!.values['picture-1']).toMatchObject({
      src: expect.stringMatching(/^\/images\/unavailable-/),
    })
  })
})
