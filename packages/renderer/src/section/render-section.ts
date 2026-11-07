import { reportIndexValues } from '../report-index.ts'
import { reportPhoto } from '../report-template.ts'
import { reportPart } from '@cms/schema'
import { reportPageLinkValues } from '@cms/schema'
import { resolveDataValueFields, dataValueBindings } from '@cms/schema'
import { siteSocialSectionValues, siteSocialGroup, usesSiteSocialAccounts } from '@cms/schema'
import { storySplitValues } from '../story-split.ts'
import { storyWorldValues } from '../story-world.ts'
import { renderHeroSlides } from '../hero-slides.ts'
import { isHeroSlides } from '@cms/schema'
import { nationalSectionPanel } from '../national-panels.ts'
import { newsroomValues } from '../newsroom.ts'
import { withStoryFeedDates, withStoryVisibility, isStoryFeedSlot } from '../story-feed-dates.ts'
import { originalLayout, originalDefinition, originalRoot } from '../original-layout.ts'
import { repeatItemKeys, sampleFieldNames, repeatItemSpec } from '@cms/schema'
import { escapeAttribute } from '../escape.ts'
import { validSectionAnchor, sectionAnchorNames } from '@cms/schema'
import { type ManifestSection, type RenderOptions } from '../types.ts'
import { BREAKPOINT_MAX_WIDTH, compiledCssProblems } from './stylesheet.ts'
import { renderSectionBody } from './body.ts'
import { applySectionBodyBehaviors } from '../behaviors/registry.ts'

export function renderSection(section: ManifestSection, index: number, options: RenderOptions = {}): string {
  const { instance, def } = section
  const revealHidden =
    (options.preview === true || options.visitorPreview === true) && options.showHiddenSections === true
  if (instance.hidden && !revealHidden) return ''

  let values = siteSocialSectionValues(
    resolveDataValueFields(
      withStoryFeedDates(withStoryVisibility(instance.values ?? {}), def.slots, def.slug),
      options.siteSettings,
      def.slots ?? [],
    ),
    def.slots ?? [],
    def.slug,
    options.siteSettings,
  )
  values = reportIndexValues(def.slug, values)
  if (def.slug === 'core-report-page-links' && options.reportLinkSections) {
    values = { ...values, ...reportPageLinkValues(options.reportLinkSections) }
    if (!options.preview && repeatItemKeys(values.links).length === 0) return ''
  }
  const sharedSocial = usesSiteSocialAccounts(instance.values ?? {}, def.slots ?? [], def.slug)
  if (
    sharedSocial &&
    !options.preview &&
    def.slug !== 'core-echelon-jump-links' &&
    repeatItemKeys(values[siteSocialGroup(def.slots ?? [])]).length === 0
  )
    return ''
  if (def.slug === 'core-stories' && Object.hasOwn(values, 'newsroom')) values = { ...values, more: values.newsroom }
  const world =
    def.slug === 'core-story-world'
      ? storyWorldValues(values, index, {
          ...options.storyWidgets,
          editing: options.preview === true || options.visitorPreview === true,
        })
      : null
  if (world) values = world.values
  const split =
    def.slug === 'core-story-split'
      ? storySplitValues(
          values,
          index,
          { ...options.storyWidgets, editing: options.preview === true || options.visitorPreview === true },
          options.newsroom,
        )
      : null
  if (split) values = split.values
  if (def.slug === 'core-newsroom')
    values = newsroomValues(values, options.newsroom, def.slots?.find(slot => slot.id === 'stories')?.constraints ?? {})
  if (!options.preview && ['board', 'photos', 'events', 'social'].includes(String(values.__cms_chapter_part))) {
    const repeats = (def.slots ?? []).filter(slot => repeatItemSpec(slot))
    if (repeats.length && repeats.every(slot => repeatItemKeys(values[slot.id], 48).length === 0)) return ''
  }
  if (
    !options.preview &&
    def.slug === 'core-story-detail' &&
    (values.story as { kind?: string; readerKey?: string; entries?: unknown[] } | undefined)?.kind === 'collection' &&
    (values.story as { readerKey?: string }).readerKey === 'stories' &&
    Array.isArray((values.story as { entries?: unknown[] }).entries) &&
    !(values.story as { entries: unknown[] }).entries.length
  )
    return ''
  if (
    !options.preview &&
    def.slug === 'core-stories' &&
    values.empty_mode === 'hide' &&
    (values.stories as { kind?: string; entries?: unknown[] } | undefined)?.kind === 'collection' &&
    !(values.stories as { entries: unknown[] }).entries.length
  )
    return ''
  // Sample cards use immutable definition examples; publication readiness requires explicit consent.
  // Real list resolution still happens in Postgres before this renderer runs.
  const metadata = def.slots?.[0]?.constraints
  const list = metadata?.coreList
  if (metadata?.coreLibrary === 'r8' && typeof list === 'string' && sampleFieldNames(values).includes(list)) {
    const bound = values[list] as { kind?: string; entries?: unknown[] } | undefined
    if (
      !(
        bound?.kind === 'collection' &&
        ((bound as { readerKey?: string }).readerKey === 'stories' ||
          (def.slots ?? []).some(slot => slot.id === list && isStoryFeedSlot(slot, def.slug)))
      ) &&
      (options.preview || bound?.kind === 'collection') &&
      !bound?.entries?.length &&
      metadata?.coreListSamples
    )
      values = { ...values, [list]: metadata.coreListSamples }
  }
  // The raw-HTML escape hatch replaces this instance's body, and nothing else:
  // the wrapper, its id, its section classes and its breakpoint classes all
  // stay, so custom CSS still lands on the same block and hide-on-mobile still
  // works on a section somebody took over. Replacing the whole wrapper would
  // quietly turn those three controls off at the moment an author was least
  // expecting it.
  //
  // Emitted verbatim, exactly as a definition's own `html` nodes are. That is
  // not this function deciding to trust it: `app.content_carries_trusted_code`
  // marks any version carrying it, and the publication trigger refuses a marked
  // version with no super-admin approval. A renderer that sanitized it instead
  // would be a third opinion about markup somebody was asked to approve, and
  // approving markup that then ships as something else is worse than either.
  const raw = (instance.raw_html ?? '').trim()
  const original =
    originalDefinition(options.originalLayout, def.section_def_id, def.version) &&
    !def.css?.trim() &&
    !raw &&
    !instance.custom_css?.trim() &&
    !instance.appearance
  let body =
    raw !== ''
      ? raw
      : renderSectionBody(def, values, {
          ...options,
          ...(original ? { siteThemeHooks: false } : {}),
          siteWidgets: { ...options.siteWidgets, widgetKey: 's' + index },
        })
  if (body === null) return ''
  const hero = (def.slots ?? []).find(isHeroSlides)
  if (!raw && hero) {
    body = renderHeroSlides(body, index, hero, values, options.preview === true)
    if (!body) return ''
  }
  // A browser embedded on Home has an h2; its full Newsroom page supplies h1.
  if (raw === '' && def.slug === 'core-newsroom' && !String(values.page_heading ?? '').trim())
    body = body.replace(/<h1 class="core-newsroom-page-heading">[\s\S]*?<\/h1>/, '')
  // The stylesheet is checked for both models, from the same columns. A section
  // whose CSS is refused does not render at all: showing its markup without its
  // styling is a different page from the one anyone approved, and a silent one.
  if (compiledCssProblems(def).length > 0) return ''

  if (!raw && options.preview && usesSiteSocialAccounts(instance.values ?? {}, def.slots ?? [], def.slug))
    body = body
      .replace(new RegExp('\\sdata-cms-slot="' + siteSocialGroup(def.slots ?? []) + '(?:__[^"]*)?"', 'g'), '')
      .replace(/\scontenteditable="true"/g, '')
  // Bound text selects its number controls; it cannot accept an inline edit that resolution would ignore.
  if (!raw && options.preview) {
    const bindings = dataValueBindings(values)
    body = body.replace(/data-cms-slot="([^"]+)" data-cms-kind="(?:text|richtext)"/g, (attributes, key: string) =>
      Object.hasOwn(bindings, key) ? `data-cms-slot="${key}" data-cms-kind="saved-number" tabindex="0"` : attributes,
    )
  }
  if (!raw) body = applySectionBodyBehaviors(body, { def, values, options, index, world, split })
  const report = reportPart(def.slug, values)
  if (options.nationalPanels && !report) body = nationalSectionPanel(body, def.slug, values)
  const blockId = `s${index}`
  const classes = ['cms-section', `cms-section--${escapeAttribute(def.slug ?? 'section')}`]
  if (report)
    classes.push(
      'cms-report-part--' + report,
      ...(!reportPhoto(values.photo) ? ['cms-report-no-photo'] : []),
      ...(!String(values.heading ?? '').trim() ? ['cms-report-no-heading'] : []),
      ...(!String(values.source ?? '').trim() ? ['cms-report-no-source'] : []),
    )
  if (def.slug === 'core-text-image' && values.__cms_report_links === true) classes.push('cms-report-index-row')
  // A breakpoint name, not free text. Escaping made the quotes safe and left
  // the spaces, so one array element `sm cms-section--other x` added three
  // class names of the author's choosing to the section wrapper — enough to
  // borrow another definition's styles. There are three breakpoints and the
  // stylesheet only has rules for those three, so anything else is not a
  // breakpoint and belongs in no class name.
  const hiddenAt = (instance.hidden_at ?? []).filter(breakpoint => Object.hasOwn(BREAKPOINT_MAX_WIDTH, breakpoint))
  for (const breakpoint of hiddenAt) {
    if (!revealHidden) classes.push(`cms-hide-${breakpoint}`)
  }

  // Preview-only instrumentation. Public output carries none of it (SPEC §8).
  const instrumentation = options.preview
    ? ` data-cms-section="${escapeAttribute(String(index))}"` +
      `${instance.hidden ? ' data-cms-hidden' : ''}${hiddenAt.length ? ` data-cms-hidden-at="${hiddenAt.join(' ')}"` : ''}` +
      ` data-cms-def="${escapeAttribute(def.section_def_id)}"` +
      ` data-cms-label="${escapeAttribute(instance.label || def.slug || '')}"`
    : ''

  const devices: Record<string, string> = { sm: 'phones', md: 'tablets', lg: 'desktops' }
  const hiddenNotice =
    revealHidden && (instance.hidden || hiddenAt.length > 0)
      ? `<div class="cms-hidden-notice">${instance.hidden ? 'Hidden from visitors' : `Hidden on ${hiddenAt.map(device => devices[device]).join(', ')}`} · Shown here for editing</div>`
      : ''
  const anchor = (
    original ? [instance.values?.__cms_anchor].filter(validSectionAnchor) : sectionAnchorNames(instance.values)
  )
    .map(name => `<span class="cms-section-anchor" id="${escapeAttribute(name)}" aria-hidden="true"></span>`)
    .join('')
  if (original) {
    const original = originalRoot(
      body,
      instrumentation,
      classes.filter(name => name.startsWith('cms-hide-')),
    )
    if (original !== null) return anchor + hiddenNotice + original
  }
  return `${anchor}${hiddenNotice}<div id="${blockId}" class="${classes.join(' ')}"${instrumentation}>${body}</div>`
}
