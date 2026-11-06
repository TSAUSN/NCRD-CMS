import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importWebsite, websiteReportMarkdown, type WebsiteImport } from './website.ts'

// A small site in the shape most existing sites have: a Bootstrap template
// with its menu bar straight in the page, a hero <header>, plain <div>
// sections, a pop-up, a form, scripts, and a footer followed by a copyright
// strip; plus one page tagged with V1's vocabulary.
const NAV =
  '<nav class="navbar"><a class="brand" href="index.html"><img src="images/logo.png" alt="Better Together"></a>' +
  '<ul><li><a href="#about">About</a></li><li><a href="hotel.html">Hotel</a></li></ul></nav>'
const FOOTER =
  '<div class="footer"><div class="container"><p>Questions? Write to us.</p></div></div><div class="copyright"><p>© 2027 The Salvation Army</p></div>'
const page = (title: string, body: string) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  `<title>${title} | Better Together</title><meta name="description" content="${title} description">` +
  '<link rel="stylesheet" href="css/site.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans">' +
  `</head><body>${NAV}<script>window.track()</script>${body}${FOOTER}<script src="js/app.js"></script></body></html>`

const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n'

let root: string
let result: WebsiteImport
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'website-import-'))
  for (const folder of ['css', 'images', 'files', 'js']) mkdirSync(join(root, folder))
  const png = (r: number, g: number, b: number) =>
    sharp({ create: { width: 64, height: 32, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer()
  writeFileSync(join(root, 'images/logo.png'), await png(200, 30, 40))
  writeFileSync(join(root, 'images/bg.png'), await png(240, 240, 250))
  writeFileSync(
    join(root, 'images/photo.jpg'),
    await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 20, g: 90, b: 60 } } })
      .jpeg()
      .toBuffer(),
  )
  writeFileSync(join(root, 'files/guide.pdf'), PDF)
  writeFileSync(join(root, 'js/app.js'), 'console.log(1)')
  writeFileSync(
    join(root, 'css/site.css'),
    'body{font-family:"Open Sans",sans-serif;color:#222}\n' +
      '.header{background:url(../images/bg.png) center/cover;padding:4rem 0}\n.basic-1{padding:2rem 0}\n.footer{background:#333;color:#fff}\n' +
      '.navbar{display:flex;gap:1rem}\n.unused-rule{color:red}',
  )
  writeFileSync(
    join(root, 'index.html'),
    page(
      'Home',
      '<header class="header" id="header"><div class="container"><h1>Better Together 2027</h1><p>Join us in <strong>Kansas City</strong>.</p>' +
        '<a class="btn" href="register.html">Register</a></div></header>' +
        '<div id="about" class="basic-1"><div class="container"><h2>About the conference</h2><p onclick="track()">Three days of learning together.</p>' +
        '<img src="images/photo.jpg" alt="People talking"><a href="files/guide.pdf">Read the guide</a></div></div>' +
        '<div class="modal fade" id="signup"><div class="modal-dialog">Sign up now</div></div>' +
        '<form action="/subscribe"><input name="email"></form>',
    ),
  )
  writeFileSync(
    join(root, 'hotel.html'),
    page(
      'Hotel',
      '<div class="basic-1" data-cms-section="Hotel details"><div class="container">' +
        '<h2 data-cms-editable="text" data-cms-id="hotel-name">The Grand Hotel</h2>' +
        '<div data-cms-editable="richtext" data-cms-id="details"><p>Book by <em>May 1</em>.</p></div>' +
        '<a data-cms-editable="link" data-cms-id="booking" href="https://example.org/book">Book a room</a>' +
        '<p data-cms-editable="skip">Fixed note</p></div></div>',
    ),
  )
  result = await importWebsite({
    root,
    name: 'Better Together 2027',
    slug: 'better-together',
    kind: 'event',
    now: new Date('2026-10-10T12:00:00Z'),
  })
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

const definition = (name: string) => result.archive.content.section_defs.find(def => def.name === name)
const source = (name: string) =>
  result.archive.content.section_def_versions.find(row => row.section_def_id === definition(name)?.id)!.source_html
/** What an editor will see in the fields: the words now live in values, not in the template. */
const pageValues = (slug: string, label: string) =>
  JSON.stringify(
    result.archive.content.page_versions
      .find(row => row.page_slug === slug)!
      .content.find(section => section.label === label)!.values,
  )
const frameValues = (kind: 'header' | 'footer') => {
  const head = result.archive.content.global_elements.find(row => row.kind === kind)!
  return JSON.stringify(
    (
      result.archive.content.global_element_versions.find(row => row.id === head.draft_version_id)!.content as {
        component: { values: unknown }
      }
    ).component.values,
  )
}

describe('importing an existing website', () => {
  it('adapts Bootstrap navigation to one governed menu and a native phone disclosure', async () => {
    const menuRoot = mkdtempSync(join(tmpdir(), 'website-menu-'))
    try {
      writeFileSync(
        join(menuRoot, 'index.html'),
        '<html><head><title>Menu test</title></head><body>' +
          '<nav class="navbar navbar-expand-lg fixed-top"><a href="index.html">Home</a>' +
          '<button class="navbar-toggler" aria-label="Toggle navigation"><span></span></button>' +
          '<div class="collapse navbar-collapse"><ul><li><a href="#about">About</a></li></ul></div></nav>' +
          '<main><section id="about"><h1>About this site</h1></section></main><footer><a href="#about">About</a></footer></body></html>',
      )
      const imported = await importWebsite({ root: menuRoot, name: 'Menu test', slug: 'menu-test' })
      const header = imported.archive.content.section_defs.find(row => row.placement === 'header')!
      expect(header, JSON.stringify(imported.report.sections)).toBeDefined()
      const version = imported.archive.content.section_def_versions.find(row => row.section_def_id === header.id)!
      expect(version.source_html).toContain('<details class="cms-import-menu">')
      expect(version.source_html).not.toContain('navbar-toggler')
      expect(version.source_html.match(/\{\{site-menu\}\}/g)).toHaveLength(2)
      expect(version.slots.filter(slot => slot.kind === 'navigation')).toHaveLength(1)
      expect(imported.archive.content.navigation_versions[0]!.tree).toEqual([
        { label: 'About', target: { type: 'url', url: '/#about' }, visible: true },
      ])
      expect(version.source_css).toContain('@media(max-width:991px)')
      expect(
        compileSection({
          sourceHtml: version.source_html,
          sourceCss: version.source_css,
          slots: version.slots,
          scopeSelector: sectionScopeSelector(header.slug)!,
        }).blocking,
      ).toEqual([])
    } finally {
      rmSync(menuRoot, { recursive: true, force: true })
    }
  })
  it('makes one private draft page per HTML file, home first, with titles and descriptions', () => {
    const { pages, page_versions: versions } = result.archive.content
    expect(pages.map(row => [row.slug, row.title, row.status, row.published_version_id])).toEqual([
      ['', 'Home', 'draft', null],
      ['hotel', 'Hotel', 'draft', null],
    ])
    expect(versions.find(row => row.page_id === pages[0]!.id)!.meta).toMatchObject({ description: 'Home description' })
  })

  it('takes the menu bar as the site header and the footer with its copyright strip as the site footer', () => {
    expect(definition('Site header')).toMatchObject({ placement: 'header' })
    expect(source('Site header')).toContain('navbar')
    expect(source('Site header')).not.toContain('Better Together 2027')
    expect(definition('Site footer')).toMatchObject({ placement: 'footer' })
    expect(source('Site footer')).toContain('class="copyright"')
    expect(frameValues('footer')).toContain('Questions? Write to us.')
    expect(frameValues('footer')).toContain('© 2027 The Salvation Army')
    const frames = result.archive.content.global_element_versions.map(
      row => (row.content as { component?: unknown }).component,
    )
    expect(frames.every(Boolean)).toBe(true)
  })

  it('keeps the hero <header> and the content blocks as sections, and nothing else', () => {
    const home = result.archive.content.page_versions.find(row => row.page_slug === '')!
    expect(home.content.map(section => section.label)).toEqual(['Better Together 2027', 'About the conference'])
    expect(pageValues('', 'Better Together 2027')).toContain('Kansas City')
  })

  it('removes and reports what a published CMS page may not carry', () => {
    const { removed } = result.report
    expect(removed['pop-up dialog']).toBe(1)
    expect(removed['form']).toBe(1)
    expect(removed['event handler']).toBe(1)
    const all = result.archive.content.section_def_versions.map(row => row.source_html).join('')
    expect(all).not.toMatch(/<script|onclick|<form|modal-dialog/)
    expect(result.report.media.remote).toEqual(
      expect.arrayContaining([expect.stringContaining('fonts.googleapis.com')]),
    )
  })

  it('points links, pictures and documents at the CMS', () => {
    const about = pageValues('', 'About the conference')
    expect(about).toMatch(/\/assets\/[0-9a-f-]{36}/)
    expect(about).toMatch(/\/media\/[0-9a-f-]{36}\/original/)
    expect(frameValues('header')).toContain('"/hotel"')
    expect(result.report.media.images).toBe(3)
    expect(result.report.documents).toBe(1)
    const css = result.archive.content.section_def_versions.map(row => row.source_css).join('\n')
    expect(css).toMatch(/url\("\/media\/[0-9a-f-]{36}\/original"\)/)
    expect(css).not.toContain('unused-rule')
  })

  it('proposes editable fields where the HTML has no tags', () => {
    const hero = result.report.sections.find(section => section.label === 'Better Together 2027')!
    expect(hero.mode).toBe('proposed')
    expect(hero.fields).toBeGreaterThan(0)
  })

  it('uses only the fields a tagged page names, with their names', () => {
    const tagged = result.report.sections.find(section => section.label === 'Hotel details')!
    expect(tagged.mode).toBe('tagged')
    const slots = result.archive.content.section_def_versions.find(
      row => row.section_def_id === definition('Hotel details')!.id,
    )!.slots
    expect(slots.map(slot => [slot.id, slot.kind])).toEqual([
      ['hotel-name', 'text'],
      ['details', 'richtext'],
      ['booking', 'link'],
    ])
    const hotel = result.archive.content.page_versions.find(row => row.page_slug === 'hotel')!
    expect(hotel.content[0]!.values).toMatchObject({
      'hotel-name': 'The Grand Hotel',
      booking: { url: 'https://example.org/book', label: 'Book a room' },
    })
    expect(source('Hotel details')).toContain('Fixed note')
  })

  it('shares the header and footer rather than copying them for every page', () => {
    expect(result.archive.content.section_defs.filter(def => def.placement === 'header')).toHaveLength(1)
    expect(result.archive.content.section_defs.filter(def => def.placement === 'footer')).toHaveLength(1)
  })

  it('writes a report a person can act on', () => {
    const markdown = websiteReportMarkdown(result.report)
    expect(markdown).toContain('# Import report: Better Together 2027')
    expect(markdown).toContain('pop-up dialog: 1')
  })
})
