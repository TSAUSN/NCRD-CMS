import { it, expect } from 'vitest'
import { withoutSamplePictures } from './sample-pictures.ts'
import { compileSection, renderPage } from './index.ts'
it('removes generic pictures from literal and derived markup while preserving local Media,links and other attributes', () => {
  const html = `<div><img src="/cms-samples/r8-square.png" alt="[Sample]"><a href="/cms-samples/guide">[Link]</a><img src="/media/11111111-1111-4111-a111-111111111111/original" alt="[Actual]"><img src='/cms-samples/r8-landscape.png'><img src="https://example.test/cms-samples/r8-square.png"></div>`,
    result = withoutSamplePictures(html)
  expect(result).toBe(
    '<div><a href="/cms-samples/guide">[Link]</a><img src="/media/11111111-1111-4111-a111-111111111111/original" alt="[Actual]"></div>',
  )
})
it('enforces the projected Echelon policy for previews and public output while ordinary sites keep their existing sample behavior', () => {
  const compiled = compileSection({
      sourceHtml: '<h1>[Page]</h1><img src="/cms-samples/r8-square.png" alt="[Sample]">',
      sourceCss: '',
      slots: [],
    }),
    manifest = {
      page: { id: 'p', version_id: 'v', title: '[Page]', path: '/' },
      sections: [
        {
          def: {
            section_def_id: 'd',
            version: 1,
            definition_kind: 'legacy' as const,
            compiled_ast: compiled.ast,
            css: compiled.css,
            slots: [],
            sanitizer_policy_version: compiled.ast.policyVersion,
            css_policy_version: compiled.ast.cssPolicyVersion,
          },
          instance: { section_def_id: 'd', section_def_version: 1, values: {} },
        },
      ],
      meta: {},
    },
    shell = {
      site: { id: 's', name: '[Site]', slug: 'site' },
      theme: {},
      navigation: [],
      canonical_host: null,
      staging_host: null,
    }
  expect(renderPage({ manifest, shell, isStaging: true }).html).toContain('<img src="/cms-samples/')
  for (const preview of [false, true])
    expect(
      renderPage({
        manifest,
        shell: { ...shell, site: { ...shell.site, chaptersEnabled: true } },
        isStaging: true,
        options: { preview },
      }).html,
    ).not.toContain('<img src="/cms-samples/')
})

it('retains only explicit generic card placeholders while reviewed compositions still omit illustrations', () => {
  const image = '<img src="/cms-samples/r8-square.png" alt="[Sample]">',
    html =
      '<div class="cms-section cms-section--core-image-link-cards">' +
      image +
      '</div><div class="cms-section cms-section--core-echelon-who">' +
      image +
      '</div>'
  expect(withoutSamplePictures(html)).toBe(
    '<div class="cms-section cms-section--core-image-link-cards">' +
      image +
      '</div><div class="cms-section cms-section--core-echelon-who"></div>',
  )
})

it('omits empty generic image markup when no approved Echelon picture was selected', () => {
  expect(
    withoutSamplePictures(
      '<section class="cms-section--core-text-image"><img src="#" alt=""></section><img src="#" alt="">',
    ),
  ).toBe('<section class="cms-section--core-text-image"></section><img src="#" alt="">')
})

it('omits unselected chapter board and gallery pictures while preserving chosen media', () => {
  for (const name of ['core-chapter-board', 'core-image-gallery']) {
    const selected = '<img src="/media/11111111-1111-4111-a111-111111111111/original" alt="[Chosen photo]">'
    const html =
      '<section class="cms-section--' +
      name +
      '"><img src="#" alt=""><img src="" alt="">' +
      selected +
      '<p>[Caption]</p></section>'
    expect(withoutSamplePictures(html)).toBe(
      '<section class="cms-section--' + name + '">' + selected + '<p>[Caption]</p></section>',
    )
  }
})
