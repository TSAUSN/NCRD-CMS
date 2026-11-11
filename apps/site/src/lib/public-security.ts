import { GA4_MEASUREMENT_ID } from '@cms/schema'
import {
  googleAnalyticsScriptHash,
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
  /** GA4 is enabled only by this site’s reviewed published settings. */
  analyticsMeasurementId?: string
}

/**
 * Allow only the fixed runtimes a page uses, the site’s reviewed script hashes, and the frame
 * sources needed by its governed embeds.
 */
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
  analyticsMeasurementId,
}: PageSecurityNeeds = {}): Record<string, string> {
  const analytics =
    typeof analyticsMeasurementId === 'string' && GA4_MEASUREMENT_ID.test(analyticsMeasurementId)
      ? analyticsMeasurementId
      : undefined
  const approvedSiteHashes = siteScriptHashes.filter(hash => /^sha256-[A-Za-z0-9+/]{43}=$/.test(hash))
  const scripts = [
    ...(hasNavigation ? [nationalNavigationScriptHash()] : []),
    ...(hasChapters ? [echelonDirectoryScriptHash()] : []),
    ...(hasStories ? [storyWidgetsScriptHash()] : []),
    ...(hasHero ? [heroSlidesScriptHash()] : []),
    ...(hasProviderEmbed ? [providerEmbedScriptHash()] : []),
    ...(hasFilter ? [faqFilterScriptHash()] : []),
    ...(hasSchedule ? [scheduleFilterScriptHash()] : []),
    ...(analytics ? [googleAnalyticsScriptHash(analytics)] : []),
    ...approvedSiteHashes,
  ]
  return {
    'content-security-policy': [
      "default-src 'none'",
      ...(scripts.length
        ? [
            `script-src ${scripts.map(hash => `'${hash}'`).join(' ')}${analytics ? ' https://www.googletagmanager.com/gtag/js' : ''}`,
          ]
        : []),
      `img-src 'self' data:${adobeFonts ? ' https://p.typekit.net' : ''}${analytics ? ' https://www.googletagmanager.com https://*.google-analytics.com' : ''}`,
      `style-src 'unsafe-inline'${hasSiteStyles ? " 'self'" : ''}${adobeFonts ? ' https://use.typekit.net https://p.typekit.net' : ''}`,
      ...(approvedSiteHashes.length || hasStories || analytics
        ? [
            "connect-src 'self'" +
              (analytics
                ? ' https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com'
                : ''),
            "script-src-attr 'none'",
          ]
        : []),
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
