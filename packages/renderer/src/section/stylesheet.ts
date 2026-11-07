import { nativeDisclosureCss } from '../native-disclosure-css.ts'
import { STORY_SPLIT_CSS } from '../story-split.ts'
import { STORY_WORLD_CSS } from '../story-world.ts'
import { isStoryFeedSlot } from '../story-feed-dates.ts'
import { STORY_GRID_CSS } from '../story-grid.ts'
import { sectionScopeSelector } from '../compile.ts'
import { narrowCompiledCss, scopeCss, validateCompiledCss, CSS_POLICY_VERSION } from '../css.ts'
import { sectionAppearanceCss } from '../section-appearance.ts'
import { type SectionDefView, type ManifestSection } from '../types.ts'

export const BREAKPOINT_MAX_WIDTH: Record<string, string> = { sm: '767px', md: '1023px', lg: '99999px' }

/** Sections that list the site's stories and need the story feed data. */
export const STORY_FEED_SLUGS = new Set(['core-stories', 'core-newsroom', 'core-story-world', 'core-story-split'])

const compiledCssCache = new Map<string, readonly string[]>()

const MAX_COMPILED_CSS_CACHE_ENTRIES = 64

const MAX_COMPILED_CSS_CACHE_CHARACTERS = 1_000_000

let compiledCssCacheCharacters = 0

/**
 * Is this definition's compiled CSS one this renderer will emit?
 *
 * A row can claim any policy version it likes, so the version is checked *and*
 * the artifact is validated. A section whose stylesheet is refused does not
 * render at all: showing its markup without its styling is a different page
 * from the one anyone approved, and a silent one.
 */
export function compiledCssProblems(def: SectionDefView): string[] {
  if (!def.css) return []
  if (def.css_policy_version !== CSS_POLICY_VERSION) {
    return [
      `compiled CSS is at policy version ${def.css_policy_version ?? 'unknown'}, ` +
        `but this renderer emits version ${CSS_POLICY_VERSION}`,
    ]
  }
  const scope = sectionScopeSelector(def.slug)
  // No scope, no stylesheet. A definition whose slug cannot become a class name
  // has nothing to confine its CSS to, and emitting it unconfined is the
  // failure this whole check exists to prevent.
  if (scope === null) return [`slug ${JSON.stringify(def.slug)} cannot be a section scope`]
  // Exact artifacts may be shared across versions or sites. Never key this
  // check by a database identity: its bytes, scope and policy remain authoritative.
  const key = scope + '\0' + def.css
  const existing = compiledCssCache.get(key)
  if (existing) return [...existing]
  const problems = validateCompiledCss(def.css, scope)
  const size = key.length + problems.reduce((total, problem) => total + problem.length, 0)
  if (size <= MAX_COMPILED_CSS_CACHE_CHARACTERS) {
    while (
      compiledCssCache.size >= MAX_COMPILED_CSS_CACHE_ENTRIES ||
      compiledCssCacheCharacters + size > MAX_COMPILED_CSS_CACHE_CHARACTERS
    ) {
      const oldest = compiledCssCache.keys().next().value!
      const oldProblems = compiledCssCache.get(oldest)!
      compiledCssCacheCharacters -= oldest.length + oldProblems.reduce((total, problem) => total + problem.length, 0)
      compiledCssCache.delete(oldest)
    }
    compiledCssCache.set(key, Object.freeze([...problems]))
    compiledCssCacheCharacters += size
  }
  return problems
}

export function collectCss(sections: readonly ManifestSection[]): string {
  const parts: string[] = []
  const seenDefs = new Set<string>()
  const stylesByScope = new Map<string, Set<string>>()
  const indicesByDefinition = new Map<string, number[]>()
  sections.forEach((section, index) => {
    const scope = sectionScopeSelector(section.def.slug ?? '')
    const key = `${section.def.section_def_id}@${section.def.version}`
    const indices = indicesByDefinition.get(key) ?? []
    indices.push(index)
    indicesByDefinition.set(key, indices)
    if (!scope) return
    const styles = stylesByScope.get(scope) ?? new Set<string>()
    styles.add(section.def.css ?? '')
    stylesByScope.set(scope, styles)
  })

  sections.forEach((section, index) => {
    const key = `${section.def.section_def_id}@${section.def.version}`
    if (section.def.css && !seenDefs.has(key)) {
      seenDefs.add(key)
      // Validated here too, not just where the markup is decided. collectCss
      // used to push stored CSS into the page untouched, which meant a row
      // claiming the current policy version got its selectors onto every page
      // that used the section.
      if (compiledCssProblems(section.def).length === 0) {
        const scope = sectionScopeSelector(section.def.slug ?? '')!
        const css =
          (stylesByScope.get(scope)?.size ?? 0) > 1
            ? narrowCompiledCss(section.def.css, scope, indicesByDefinition.get(key)!)
            : section.def.css
        if (css === null) throw new Error('The styles for mixed section versions could not be isolated')
        parts.push(nativeDisclosureCss(css))
      }
    }
    if (!section.instance.raw_html?.trim() && !section.instance.custom_css?.trim()) {
      parts.push(sectionAppearanceCss(section.def, section.instance.appearance, index))
    }
    // Per-block custom CSS is scoped to that block's id, so one section's
    // escape hatch can never restyle another.
    if (section.instance.custom_css) {
      // Refused whole when the policy blocks any of it, for the same reason a
      // definition's stylesheet is: a section shown with half its styling is a
      // different section from the one somebody wrote, and the half that
      // survived is whichever half happened to parse. `checkCustomCss` in the
      // admin runs this same call so the author is told which rule it was
      // rather than watching their styling not arrive.
      const scoped = scopeCss(section.instance.custom_css, `#s${index}`)
      if (scoped.blocking.length === 0) parts.push(scoped.css)
    }
  })

  if (
    sections.some(
      ({ def, instance }) =>
        !instance.raw_html?.trim() &&
        STORY_FEED_SLUGS.has(def.slug ?? '') &&
        (def.slots ?? []).some(slot => isStoryFeedSlot(slot, def.slug)),
    )
  )
    parts.push(STORY_GRID_CSS)

  if (
    sections.some(
      ({ def, instance }) =>
        !instance.raw_html?.trim() && ['core-story-world', 'core-story-split'].includes(def.slug ?? ''),
    )
  )
    parts.push(STORY_WORLD_CSS)
  if (sections.some(({ def, instance }) => !instance.raw_html?.trim() && def.slug === 'core-story-split'))
    parts.push(STORY_SPLIT_CSS)

  // Breakpoint visibility is a bounded, declared control — not free
  // per-viewport layout.
  parts.push(`@media (max-width:${BREAKPOINT_MAX_WIDTH['sm']}){.cms-hide-sm{display:none !important}}`)
  parts.push(
    `@media (min-width:768px) and (max-width:${BREAKPOINT_MAX_WIDTH['md']}){.cms-hide-md{display:none !important}}`,
  )
  parts.push(`@media (min-width:1024px){.cms-hide-lg{display:none !important}}`)
  return parts.join('')
}
