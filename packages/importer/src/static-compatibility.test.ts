import { describe, expect, it } from 'vitest'
import { applyLegacyValues } from './legacy-values.ts'
import { staticCompatibility } from './static-compatibility.ts'
import { compareRenderings } from './parity.ts'
import { disclosureCss, inertReference, markFaqFilter, restoreNativeDisclosures } from './inert-reference.ts'
import { remapReferenceUrls } from './media-transfer.ts'

describe('passive static compatibility', () => {
  it('preserves static copy, repeated content and inline SVG the typed importer cannot represent', () => {
    const html =
      '<section><svg viewBox="0 0 24 24"><path d="M1 1L2 2" /></svg><h2>Source copy</h2><p>First</p><p>Second</p></section>'
    const result = staticCompatibility({ slug: 'source-reference', html, css: 'section{padding:2rem}' })
    expect(result.status).toBe('compatible-reference')
    expect(result.compiled?.ast.nodes).toEqual([{ kind: 'html', value: html }])
    expect(result.sourceCss).toBe('section{padding:2rem}')
  })
  it.each([
    '<script>alert(1)</script>',
    '<iframe src="https://example.test"></iframe>',
    '<form><input></form>',
    '<svg><animate attributeName="href"></animate></svg>',
    '<a href="java&#115;cript:alert(1)">unsafe</a>',
    '<img src="/x" onerror="alert(1)">',
  ])('refuses active functionality whole: %s', html => {
    expect(staticCompatibility({ slug: 'source-reference', html, css: '' }).compiled).toBeNull()
  })
  it('records stylesheet losses while retaining the original source for review', () => {
    const css = '@keyframes turn{to{transform:rotate(1turn)}}section{animation:turn 2s}'
    const result = staticCompatibility({ slug: 'source-reference', html: '<section>Saved text</section>', css })
    expect(result.status).toBe('review-reference')
    expect(result.issues).toContain('stylesheet-policy-review')
    expect(result.sourceCss).toBe(css)
  })
  it('does not interpret literal interpolation-looking content or silently drop it', () => {
    expect(staticCompatibility({ slug: 'source-reference', html: '<p>{{authored}}</p>', css: '' }).compiled).toBeNull()
  })
})

describe('stored V1 field values', () => {
  it('retains markup inside V1 text fields, escaped labels, image values and absent link intent', () => {
    const html =
      '<section><h1 data-block-id="title" data-editable="text">Before</h1><a data-block-id="link" data-editable="link" href="/original" target="_blank" rel="noopener noreferrer">Before</a><img data-block-id="photo" data-editable="image" src="/before" alt="Before"></section>'
    const result = applyLegacyValues(html, {
      title: { html: 'Saved<br><em>headline</em>', hidden: false },
      link: { text: 'A & B' },
      photo: { src: '/after', alt: 'Saved photo' },
    })
    expect(result.issues).toEqual([])
    expect(result.html).toContain('Saved<br><em>headline</em>')
    expect(result.html).toContain('href="/original" target="_blank" rel="noopener noreferrer"')
    expect(result.html).toContain('A &amp; B')
    expect(result.html).toContain('src="/after" alt="Saved photo"')
    expect(result.appliedFields).toBe(3)
  })
  it('preserves authored hidden, clears it explicitly, applies safe icons and names unsupported style changes', () => {
    const html =
      '<section><p hidden data-block-id="a" data-editable="text">Before</p><a data-block-id="b" data-editable="link" href="#">Link</a><span data-block-id="c" data-editable="icon"><svg></svg></span></section>'
    const result = applyLegacyValues(html, {
      a: { html: 'Saved' },
      b: { style: { color: 'primary' } },
      c: { svg: '<svg></svg>' },
    })
    expect(result.html).toContain('<p hidden=""')
    expect(result.issues).toEqual(['button-style-review'])
    expect(result.appliedFields).toBe(2)
    expect(applyLegacyValues(html, { a: { hidden: false } }).html).not.toContain('hidden=')
  })
  it('requires review for missing regions and preserves unchanged semantic trees', () => {
    const html = '<section class="source"><h2>Words &amp; text</h2></section>'
    const result = applyLegacyValues(html, { missing: { html: 'Cannot map' } })
    expect(result.issues).toContain('unmapped-saved-region')
    expect(compareRenderings(html, result.html)).toEqual([])
  })
  it('does not mistake a derived button style for an override, and preserves source icon sizing', () => {
    const result = applyLegacyValues(
      '<section><a data-block-id="link" data-editable="link" href="#">Link</a><span data-block-id="icon" data-editable="icon"><svg class="w-6 h-6 old"></svg></span></section>',
      {
        link: { style: { derived: true, color: 'white' } },
        icon: { svg: '<svg class="new"><path d="M1 1L2 2" /></svg>', name: 'arrow' },
      },
    )
    expect(result.issues).toEqual([])
    expect(result.html).toContain('class="new w-6 h-6"')
    expect(result.html).toContain('data-icon-name="arrow"')
  })
  it('respects V1 content epochs and shapes rather than injecting stale saved HTML', () => {
    const result = applyLegacyValues(
      '<p data-block-id="copy" data-editable="richtext" data-content-epoch="2"><a href="#">New structure</a></p>',
      { copy: { html: 'Stale content', shape: '', epoch: 1 } },
    )
    expect(result.html).toContain('New structure')
    expect(result.html).not.toContain('Stale content')
    expect(result.issues).toContain('stale-saved-region-retained')
    expect(result.appliedFields).toBe(0)
  })
})

describe('inert references and governed image URLs', () => {
  it('restores JS-disclosures using native keyboard-accessible details and summary', () => {
    const result = inertReference(
      '<div class="faq-item"><button class="faq-btn" aria-expanded="false">Question</button><div class="faq-answer" aria-hidden="true" inert><p>Authored answer</p></div></div>',
      { openFirst: true },
    )
    // HNI's V1 script opened the first question on load.
    expect(result.html).toMatch(/<details class="faq-item" open(="")?>/)
    expect(result.html).toContain('<summary class="faq-btn">Question</summary>')
    expect(result.html).not.toContain('disabled')
    expect(result.html).not.toContain('aria-hidden="true"')
    expect(result.html).toContain('Authored answer')
    expect(result.issues).toContain('native-disclosure-restored')
    expect(staticCompatibility({ slug: 'native-faq', html: result.html, css: '' }).compiled).not.toBeNull()
  })
  it('shows answers V1 kept hidden for its script, opens only the first, and repairs an earlier disabled import (FID-04)', () => {
    const item = (n: number, disabled = '') =>
      `<div class="faq-item"><button class="faq-btn" type="button" aria-expanded="false" aria-controls="faq-a${n}"${disabled}><span>Q${n}</span></button><div id="faq-a${n}" class="faq-answer" hidden><p>A${n}</p></div></div>`
    const fresh = inertReference(`<div id="faq-grid">${item(1)}${item(2)}</div>`, { openFirst: true })
    expect(fresh.html).not.toMatch(/hidden|aria-controls|aria-expanded/)
    expect(fresh.html.match(/<details[^>]*>/g)).toEqual([
      '<details class="faq-item" open="">',
      '<details class="faq-item">',
    ])
    const earlier = restoreNativeDisclosures(
      `<div id="faq-grid">${item(1, ' disabled=""')}${item(2, ' disabled=""')}</div>`,
      { openFirst: true },
    )
    expect(earlier.restored).toBe(2)
    expect(earlier.html).toBe(fresh.html)
    expect(restoreNativeDisclosures('<p>No FAQ</p>')).toEqual({ html: '<p>No FAQ</p>', restored: 0 })
  })
  it('keeps every question closed where the site’s V1 script did, even after an earlier import opened them all (FID-05)', () => {
    const opened = (n: number) =>
      `<div class="faq-item"><button class="faq-btn" type="button" aria-expanded="true"><span>Q${n}</span></button><div class="faq-answer"><p>A${n}</p></div></div>`
    const closed = (n: number) =>
      `<div class="faq-item"><button class="faq-btn" type="button" aria-expanded="false"><span>Q${n}</span></button><div class="faq-answer"><p>A${n}</p></div></div>`
    const fresh = inertReference(`<div id="faq-grid">${closed(1)}${closed(2)}${closed(3)}</div>`)
    expect(fresh.html.match(/<details[^>]*>/g)).toEqual([
      '<details class="faq-item">',
      '<details class="faq-item">',
      '<details class="faq-item">',
    ])
    const earlier = restoreNativeDisclosures(`<div id="faq-grid">${opened(1)}${opened(2)}${opened(3)}</div>`)
    expect(earlier.restored).toBe(3)
    expect(earlier.html).toBe(fresh.html)
    expect(earlier.html).toContain('<p>A3</p>')
  })
  it('marks V1’s FAQ search, its no-match line and its clear button for the governed filter, leaving the box disabled (D3)', () => {
    const source =
      '<section><div class="faq-search-wrap"><input type="search" id="faq-search" class="faq-search" aria-label="Search"></div>' +
      '<div id="faq-grid"><div class="faq-item"><button class="faq-btn" aria-expanded="false">Q</button><div class="faq-answer" hidden><p>A</p></div></div></div>' +
      '<p id="faq-no-results" class="faq-no-results" hidden>No questions match. <button type="button" id="faq-clear-filter">clear the filter</button>.</p></section>'
    const fresh = inertReference(source, { openFirst: true })
    expect(fresh.html).toMatch(
      /<input type="search" id="faq-search" class="faq-search" aria-label="Search" disabled="" data-cms-faq-filter="">/,
    )
    expect(fresh.html).toContain('data-cms-faq-empty=""')
    expect(fresh.html).toMatch(/<button type="button" id="faq-clear-filter" disabled="" data-cms-faq-clear="">/)
    expect(fresh.issues).toContain('faq-search-governed-filter')
    // An earlier import's disabled copy gains the same markers, once.
    const earlier = markFaqFilter(source.replace('aria-label="Search">', 'aria-label="Search" disabled="">'))
    expect(earlier.marked).toBe(3)
    expect(markFaqFilter(earlier.html)).toEqual({ html: earlier.html, marked: 0 })
    expect(staticCompatibility({ slug: 'faq-filter', html: fresh.html, css: '' }).compiled).not.toBeNull()
  })
  it('gives an open disclosure V1’s open-question styles', () => {
    const css = disclosureCss(
      '.faq-btn{color:#132230}.faq-btn[aria-expanded="true"]{color:var(--color-primary)}.faq-btn[aria-expanded="true"] .faq-chevron,.x{transform:rotate(180deg)}',
    )
    expect(css).toBe(
      'summary.faq-btn{list-style:none}summary.faq-btn::-webkit-details-marker{display:none}' +
        'details[open] > .faq-btn{color:var(--color-primary)}details[open] > .faq-btn .faq-chevron{transform:rotate(180deg)}',
    )
    expect(disclosureCss('.a{color:red}')).toBe('')
  })
  it('restores native anchor scrolling without accepting external destinations or scripts', () => {
    const result = inertReference(
      '<button class="button" data-scroll-target="#agenda-panel">View agenda</button><button data-scroll-target="https://example.test">External</button>',
    )
    expect(result.html).toContain('<a class="button" href="#agenda-panel" data-editable="link">View agenda</a>')
    expect(result.html).toContain('<button data-scroll-target="https://example.test" disabled="">External</button>')
    expect(result.issues).toContain('native-scroll-link-restored')
  })
  it('namespaces V1 editor markers so canvas selection reaches the V2 wrapper', () => {
    const result = inertReference('<section data-cms-section="home-hero"><h2>Source heading</h2></section>')
    expect(result.html).toContain('data-v1-cms-section="home-hero"')
    expect(result.html).not.toMatch(/\sdata-cms-section=/)
    expect(result.issues).toContain('editor-marker-namespaced')
  })
  it('retains forms and embed labels visibly without live controls or frames', () => {
    const source =
      '<section><form action="/submit"><label>Search<input value="Saved"></label><button>Search now</button></form><iframe title="National view" src="https://example.test/chart"></iframe></section>'
    const inert = inertReference(source)
    expect(inert.html).toContain('value="Saved" disabled=""')
    expect(inert.html).toContain('Search now')
    expect(inert.html).toContain('National view')
    expect(inert.html).not.toMatch(/<(form|iframe)\b/)
    expect(staticCompatibility({ slug: 'inert', html: inert.html, css: '' }).compiled).not.toBeNull()
    expect(inert.issues).toContain('embedded-view-needs-integration')
  })
  it('remaps src, srcset and CSS assets while preserving prose and recording unavailable files', () => {
    const id = '10000000-0000-4000-a000-000000000000'
    const result = remapReferenceUrls(
      '<section><p>/images/a.png</p><img src="/images/a.png" srcset="/images/a.png 1x, /images/a.png 2x" alt="Saved"><a href="/files/report.pdf">Report</a><a href="/methodology.html#data">Methodology</a></section>',
      '.photo{background:url("/images/a.png")}',
      new Map([['/images/a.png', { url: `/media/${id}/original`, mediaId: id }]]),
      new Map([['/methodology.html', '/source-methodology']]),
    )
    expect(result.html).toContain('<p>/images/a.png</p>')
    expect(result.html).toContain(`src="/media/${id}/original"`)
    expect(result.html).toContain('href="/source-methodology#data"')
    expect(result.css).toContain(`/media/${id}/original`)
    expect(result.mediaIds).toEqual([id])
    expect(result.unresolved).toEqual(['/files/report.pdf'])
  })
})
