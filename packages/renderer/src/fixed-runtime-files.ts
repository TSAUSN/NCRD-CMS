import { NATIONAL_NAVIGATION_RUNTIME, nationalNavigationScriptHash } from './national-navigation-runtime.ts'
import { ECHELON_DIRECTORY_RUNTIME, echelonDirectoryScriptHash } from './echelon-directory-runtime.ts'
import { STORY_WIDGETS_RUNTIME, storyWidgetsScriptHash } from './story-widgets-runtime.ts'
import { HERO_SLIDES_RUNTIME, heroSlidesScriptHash } from './hero-slides-runtime.ts'
import { FAQ_FILTER_RUNTIME, faqFilterScriptHash } from './faq-filter.ts'
import { SCHEDULE_FILTER_RUNTIME, scheduleFilterScriptHash } from './schedule-filter.ts'
import { PROVIDER_EMBED_RUNTIME, providerEmbedScriptHash } from './provider-embed.ts'
export type FixedRuntimeName = 'faq' | 'schedule' | 'embed' | 'hero' | 'stories' | 'chapters' | 'navigation'
/** The existing closed, code-owned widgets. Script-enabled sites use exact
 * external bytes under the same hashes, without adding inline execution. */
const FILES = (
  [
    ['navigation', NATIONAL_NAVIGATION_RUNTIME, nationalNavigationScriptHash()],
    ['chapters', ECHELON_DIRECTORY_RUNTIME, echelonDirectoryScriptHash()],
    ['stories', STORY_WIDGETS_RUNTIME, storyWidgetsScriptHash()],
    ['hero', HERO_SLIDES_RUNTIME, heroSlidesScriptHash()],
    ['faq', FAQ_FILTER_RUNTIME, faqFilterScriptHash()],
    ['schedule', SCHEDULE_FILTER_RUNTIME, scheduleFilterScriptHash()],
    ['embed', PROVIDER_EMBED_RUNTIME, providerEmbedScriptHash()],
  ] as const
).map(([name, source, integrity]) => ({
  name,
  source,
  integrity,
  file: `${name}.${integrity.slice(7).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}.js`,
}))
export function fixedRuntimeFile(file: string) {
  return FILES.find(item => item.file === file) ?? null
}
export function fixedRuntimeTag(name: FixedRuntimeName, external: boolean): string {
  const file = FILES.find(item => item.name === name)!
  return external
    ? `<script src="/__cms/runtime/${file.file}" integrity="${file.integrity}"></script>`
    : `<script>${file.source}</script>`
}
