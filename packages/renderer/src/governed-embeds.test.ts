import { describe, expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { renderSection } from './render.ts'
import { stripPreviewInstrumentation } from './preview-runtime.ts'
import { governedEmbed, governedEmbedFrameSources, renderGovernedEmbed } from './governed-embeds.ts'

describe('the links a governed embed accepts', () => {
  it('rebuilds YouTube and Vimeo videos from their identifiers, privacy-enhanced', () => {
    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1',
    ]) {
      expect(governedEmbed('video', link)).toMatchObject({
        provider: 'youtube',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      })
    }
    expect(governedEmbed('video', 'https://vimeo.com/76979871')).toMatchObject({
      provider: 'vimeo',
      embedUrl: 'https://player.vimeo.com/video/76979871?dnt=1',
    })
    expect(governedEmbed('video', 'https://vimeo.com/76979871/abc123def4')).toMatchObject({
      embedUrl: 'https://player.vimeo.com/video/76979871?dnt=1&h=abc123def4',
    })
    expect(governedEmbed('video', 'https://player.vimeo.com/video/76979871')?.openUrl).toBe(
      'https://vimeo.com/76979871',
    )
  })

  it('takes a Google Maps embed address and Microsoft or Google Forms share links', () => {
    expect(governedEmbed('map', 'https://www.google.com/maps/embed?pb=!1m18!1m12!3d40.7!2d-74.0')).toMatchObject({
      provider: 'google-maps',
      embedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!3d40.7!2d-74.0',
    })
    expect(governedEmbed('form', 'https://forms.office.com/r/AbC123xyZ9')).toMatchObject({
      provider: 'microsoft-forms',
      embedUrl: 'https://forms.office.com/r/AbC123xyZ9?embed=true',
    })
    expect(
      governedEmbed('form', 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN')
        ?.embedUrl,
    ).toBe('https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN&embed=true')
    expect(
      governedEmbed(
        'form',
        'https://docs.google.com/forms/d/e/1FAIpQLSf_example_form_identifier_value/viewform?usp=sf_link',
      ),
    ).toMatchObject({
      provider: 'google-forms',
      embedUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSf_example_form_identifier_value/viewform?embedded=true',
    })
  })

  it('refuses everything else, including the right provider for the wrong kind', () => {
    for (const [kind, link] of [
      ['video', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      ['video', 'https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ'],
      ['video', 'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ'],
      ['video', 'https://evil.example/watch?v=dQw4w9WgXcQ'],
      ['video', 'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
      ['video', 'https://www.youtube.com/watch?v=short'],
      ['video', 'javascript:alert(1)'],
      ['video', 'https://vimeo.com/channels/staffpicks'],
      ['video', 'https://www.google.com/maps/embed?pb=!1m2'],
      ['map', 'https://www.google.com/maps/place/Somewhere'],
      ['map', 'https://maps.app.goo.gl/abc'],
      ['map', 'https://www.google.com/maps/embed?pb=<script>'],
      ['form', 'https://forms.gle/abcdef'],
      ['form', 'https://docs.google.com/document/d/abc/edit'],
      ['form', 'https://forms.office.com/r/x'],
      ['form', 'https://youtu.be/dQw4w9WgXcQ'],
      ['video', ''],
      ['video', null],
      ['video', 'x'.repeat(5000)],
    ] as const)
      expect({ kind, link, embed: governedEmbed(kind, link) }).toEqual({ kind, link, embed: null })
  })
})

describe('a governed embed on the page', () => {
  const link = 'https://youtu.be/dQw4w9WgXcQ'
  it('shows a consent card that loads the provider only when asked, with a direct link beside it', () => {
    const html = renderGovernedEmbed('video', link, 'A year in "ninety" seconds')
    expect(html).toContain('data-cms-embed-provider="youtube"')
    expect(html).toContain('title="A year in &quot;ninety&quot; seconds"')
    expect(html).toContain('srcdoc="')
    expect(html).not.toMatch(/<iframe[^>]* src=/)
    expect(html).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(html).toContain(
      '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer">Open the video on YouTube</a>',
    )
    expect(governedEmbedFrameSources(html)).toEqual(['https://www.youtube-nocookie.com'])
  })
  it('is an inert card in previews, and a hint or nothing when the link is not accepted', () => {
    const preview = renderGovernedEmbed('video', link, 'Video', { preview: true })
    expect(preview).not.toContain('<iframe')
    expect(preview).toContain('YouTube video. Visitors choose whether to load it on the public page.')
    expect(governedEmbedFrameSources(preview)).toEqual([])
    expect(
      renderGovernedEmbed('video', '#', 'Video', { preview: true, empty: 'Paste a YouTube or Vimeo link.' }),
    ).toContain('Paste a YouTube or Vimeo link.')
    expect(renderGovernedEmbed('video', '#', 'Video', { empty: 'Paste a YouTube or Vimeo link.' })).toBe('')
  })
  it('fills a section’s own frame when the definition names its frame and placeholder classes', () => {
    const fitted = { frameClass: 'video__iframe', placeholderClass: 'video__placeholder' }
    const html = renderGovernedEmbed('video', link, 'Embedded video', fitted)
    expect(html).toMatch(
      /^<iframe class="video__iframe" data-cms-embed-provider="youtube" title="Embedded video" srcdoc="[^"]*"[^>]*><\/iframe>$/,
    )
    expect(html).not.toContain(' style=')
    // No room beside the frame, so the notice itself offers the direct link.
    expect(html).toContain('Open it on YouTube')
    expect(governedEmbedFrameSources(html)).toEqual(['https://www.youtube-nocookie.com'])
    expect(renderGovernedEmbed('video', link, 'Embedded video', { ...fitted, preview: true })).toBe(
      '<p class="video__placeholder"><span><strong>Embedded video</strong><br>YouTube video. Visitors choose whether to load it on the public page.<br>' +
        '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer">Open the video on YouTube</a></span></p>',
    )
    expect(
      renderGovernedEmbed('video', '', 'Embedded video', { ...fitted, providerEmbeds: false, empty: 'Paste a link.' }),
    ).toBe('<p class="video__placeholder">Paste a link.</p>')
    expect(renderGovernedEmbed('video', '', 'Embedded video', { ...fitted, empty: 'Paste a link.' })).toBe('')
    // A class that is not a plain name is ignored, not escaped into place.
    expect(renderGovernedEmbed('video', link, 'Video', { frameClass: 'x" onload="alert(1)' })).toContain(
      '<div class="cms-governed-embed"',
    )
  })
  it('renders from a link field that declares the embed kind, the same in preview and public apart from the card', () => {
    const slots = [
      {
        id: 'clip',
        kind: 'link' as const,
        label: 'Video address',
        constraints: { embed: 'video', embedTitle: 'Embedded video', embedHelp: 'Paste a YouTube or Vimeo link.' },
      },
    ]
    const compiled = compileSection({
      sourceHtml: '<div class="frame">{{clip}}</div>',
      slots,
      scopeSelector: '.cms-section--video',
    })
    expect(compiled.blocking).toEqual([])
    const section = (url: string) =>
      ({
        def: { section_def_id: 'd', version: 1, slug: 'video', compiled_ast: compiled.ast, slots },
        instance: { section_def_id: 'd', section_def_version: 1, values: { clip: { url } } },
      }) as Parameters<typeof renderSection>[0]
    expect(renderSection(section(link), 0)).toContain(
      '<div class="frame"><div class="cms-governed-embed" style="min-width:0" data-cms-embed-provider="youtube"><iframe title="Embedded video"',
    )
    expect(renderSection(section('https://evil.example/x'), 0)).toContain('<div class="frame"></div>')
    expect(stripPreviewInstrumentation(renderSection(section('#'), 0, { preview: true }))).toContain(
      'Paste a YouTube or Vimeo link.',
    )
    // A library section is inserted with no value at all for its embed.
    const inserted = {
      ...section(link),
      instance: { section_def_id: 'd', section_def_version: 1, values: {} },
    } as Parameters<typeof renderSection>[0]
    expect(stripPreviewInstrumentation(renderSection(inserted, 0, { preview: true }))).toContain(
      'Paste a YouTube or Vimeo link.',
    )
    expect(renderSection(inserted, 0)).toContain('<div class="frame"></div>')
  })
})
