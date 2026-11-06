import {
  nationalNavigationScriptHash,
  echelonDirectoryScriptHash,
  faqFilterScriptHash,
  scheduleFilterScriptHash,
  providerEmbedScriptHash,
  heroSlidesScriptHash,
  storyWidgetsScriptHash,
} from '@cms/renderer'

/** What a page needs from its security policy. Every flag defaults to off. */
export type PageSecurityNeeds = {
  /** Governed chart fullscreen control. */
  providerFullscreen?: boolean
  /** Frame sources of the governed embeds the page shows. */
  embedSources?: readonly string[]
  faqFilter?: boolean
  scheduleFilter?: boolean
  heroSlides?: boolean
  storyWidgets?: boolean
  chapterDirectory?: boolean
  nationalNavigation?: boolean
  /** Hashes of the site's own reviewed script files. Malformed values are ignored. */
  siteScriptHashes?: readonly string[]
  /** The site serves its own reviewed stylesheet files. */
  siteStyles?: boolean
  /** The page loads the site's approved Adobe Fonts kit. */
  adobeFonts?: boolean
}

/** SPEC §8: default-deny. A page gets the exact hash of each fixed runtime it
 * uses (navigation, chapter directory, story widgets, hero slides, chart
 * fullscreen, FAQ and schedule filters), its site's reviewed script hashes,
 * and frame sources only for the governed embeds it shows. */
export function publicSecurityHeaders({
  providerFullscreen: hasProviderEmbed = false,
  embedSources = [],
  faqFilter: hasFilter = false,
  scheduleFilter: hasSchedule = false,
  heroSlides: hasHero = false,
  storyWidgets: hasStories = false,
  chapterDirectory: hasChapters = false,
  nationalNavigation: hasNavigation = false,
  siteScriptHashes = [],
  siteStyles: hasSiteStyles = false,
  adobeFonts = false,
}: PageSecurityNeeds = {}): Record<string, string> {
  const approvedSiteHashes = siteScriptHashes.filter(hash => /^sha256-[A-Za-z0-9+/]{43}=$/.test(hash))
  const scripts = [
    ...(hasNavigation ? [nationalNavigationScriptHash()] : []),
    ...(hasChapters ? [echelonDirectoryScriptHash()] : []),
    ...(hasStories ? [storyWidgetsScriptHash()] : []),
    ...(hasHero ? [heroSlidesScriptHash()] : []),
    ...(hasProviderEmbed ? [providerEmbedScriptHash()] : []),
    ...(hasFilter ? [faqFilterScriptHash()] : []),
    ...(hasSchedule ? [scheduleFilterScriptHash()] : []),
    ...approvedSiteHashes,
  ]
  return {
    'content-security-policy': [
      "default-src 'none'",
      ...(scripts.length ? [`script-src ${scripts.map(hash => `'${hash}'`).join(' ')}`] : []),
      `img-src 'self' data:${adobeFonts ? ' https://p.typekit.net' : ''}`,
      `style-src 'unsafe-inline'${hasSiteStyles ? " 'self'" : ''}${adobeFonts ? ' https://use.typekit.net https://p.typekit.net' : ''}`,
      ...(approvedSiteHashes.length || hasStories ? ["connect-src 'self'", "script-src-attr 'none'"] : []),
      `font-src 'self'${adobeFonts ? ' https://use.typekit.net' : ''}`,
      `frame-src 'self' https://public.tableau.com${embedSources.map(source => ` ${source}`).join('')}`,
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  }
}
