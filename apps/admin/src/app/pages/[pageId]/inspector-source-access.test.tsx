import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEditorState, setSelection } from '@cms/domain'
import type { ComponentProps } from 'react'
vi.mock('../../actions/section-definitions.ts', () => ({ checkCustomCss: vi.fn() }))
vi.mock('./hero-copy-actions.ts', () => ({ loadHeroCopyTargets: vi.fn(), copyHeroSlide: vi.fn() }))
vi.mock('./page-details-fields.tsx', () => ({ PageDetailsFields: () => null }))
vi.mock('./page-checklist.tsx', () => ({ PageChecklist: () => null }))
vi.mock('./media-picker.tsx', () => ({ MediaPicker: () => null }))
vi.mock('./collection-field.tsx', () => ({ CollectionField: () => null }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
import { Inspector } from './inspector.tsx'
import { SectionSourceControls } from './section-source-controls.tsx'

function render(canAuthorSource: boolean, code = true, selectedTitle = false) {
  const state = setSelection(
    createEditorState({
      sections: [
        {
          section_def_id: 'def-a',
          section_def_version: 1,
          values: { heading: 'Editable content' },
          ...(code ? { custom_css: 'PRIVATE_CSS_SOURCE', raw_html: '<p>PRIVATE_HTML_SOURCE</p>' } : {}),
        },
      ],
      meta: {},
    }),
    { section: 0, slot: selectedTitle ? 'heading' : null },
  )
  const noop = () => undefined
  const props: ComponentProps<typeof Inspector> = {
    state,
    entry: {
      section_def_id: 'def-a',
      version: 1,
      name: 'Sample section',
      slug: 'sample',
      category: 'Tests',
      definition_kind: 'legacy',
      scope: 'site',
      site_id: 'site-a',
      slots: [{ id: 'heading', kind: 'text', label: 'Heading' }],
      thumbnail_path: null,
      carries_trusted_code: false,
      used_on_pages: 1,
      used_on_sites: 1,
    },
    latestEntry: null,
    siteId: 'site-a',
    metadataContext: { path: '/' },
    hasEditableFields: true,
    linkTargets: [],
    mediaAssets: [],
    themeColors: {},
    readiness: null,
    trustedCodeApproved: true,
    canAuthorSource,
    canAdvanced: canAuthorSource,
    onRestoreSlot: noop,
    onSelectSlot: noop,
    onDone: noop,
    onReviewUpgrade: noop,
    onChange: noop,
    onValuesChange: noop,
    onRevertSlot: noop,
    onMetaChange: noop,
    onAppearanceChange: noop,
    onToggleBreakpoint: noop,
    onToggleHidden: noop,
    onChangeLayout: noop,
    onUpdateImportedFields: noop,
    onLabelChange: noop,
    onAddBelow: noop,
    onCustomCss: noop,
    onRawHtml: noop,
    onAddSection: noop,
    pageSettingsOpen: false,
    onPageSettingsToggle: noop,
  }
  return renderToStaticMarkup(<Inspector {...props} />)
}
describe('page source authoring access', () => {
  it('retains ordinary fields and explains existing source without exposing editable source controls', () => {
    const html = render(false)
    expect(html).toContain('Editable content')
    expect(html).toContain('This section contains preserved custom code')
    expect(html).not.toContain('PRIVATE_CSS_SOURCE')
    expect(html).not.toContain('PRIVATE_HTML_SOURCE')
    expect(html).not.toContain('Custom CSS for this section')
    expect(html).not.toContain('Edit the HTML of this section')
  })
  it('does not add a source warning to an ordinary section', () => {
    const html = render(false, false)
    expect(html).toContain('Editable content')
    expect(html).not.toContain('preserved custom code')
    expect(html).not.toContain('Custom CSS for this section')
  })
  it('keeps both source controls available to Super Admins', () => {
    const html = render(true)
    expect(html).toContain('Advanced')
    expect(html).not.toContain('PRIVATE_CSS_SOURCE')
    expect(html).not.toContain('PRIVATE_HTML_SOURCE')
    const advanced = renderToStaticMarkup(
      <SectionSourceControls
        index={0}
        css="PRIVATE_CSS_SOURCE"
        html="PRIVATE_HTML_SOURCE"
        approved
        canEditHtml
        onCustomCss={() => {}}
        onRawHtml={() => {}}
      />,
    )
    expect(advanced).toContain('Custom CSS for this section')
    expect(advanced).toContain('Edit the HTML of this section')
    expect(advanced).toContain('PRIVATE_CSS_SOURCE')
    expect(advanced).toContain('PRIVATE_HTML_SOURCE')
  })
})

it('keeps Site Admin CSS controls separate from Super Admin HTML authoring', () => {
  const advanced = renderToStaticMarkup(
    <SectionSourceControls
      index={0}
      css="PRIVATE_CSS_SOURCE"
      html="PRIVATE_HTML_SOURCE"
      approved={false}
      canEditHtml={false}
      onCustomCss={() => {}}
      onRawHtml={() => {}}
    />,
  )
  expect(advanced).toContain('PRIVATE_CSS_SOURCE')
  expect(advanced).not.toContain('PRIVATE_HTML_SOURCE')
  expect(advanced).not.toContain('Edit the HTML of this section')
})

it('keeps focused title editing free of source and section management controls', () => {
  const html = render(false, true, true)
  expect(html).toContain('Section title')
  expect(html).toContain('Editable content')
  expect(html).toContain('Back')
  expect(html).toContain('Done')
  for (const hidden of [
    'PRIVATE_CSS_SOURCE',
    'PRIVATE_HTML_SOURCE',
    'Add section below',
    'Section settings',
    'Layout:',
  ])
    expect(html).not.toContain(hidden)
})
