import { GA4_MEASUREMENT_ID, type SitePublicSettings } from '@cms/schema'
import { sha256Base64 } from './sha256.ts'

/** Only a published, explicitly enabled site setting can request this runtime. */
export function googleAnalyticsForPage(settings: SitePublicSettings | undefined, isStaging: boolean) {
  const analytics = settings?.analytics
  return analytics?.enabled &&
    GA4_MEASUREMENT_ID.test(analytics.measurementId) &&
    (!isStaging || analytics.includeStaging)
    ? analytics.measurementId
    : undefined
}
export function googleAnalyticsBootstrap(id: string): string {
  if (!GA4_MEASUREMENT_ID.test(id)) throw new Error('Invalid GA4 Measurement ID')
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(id)},{page_location:location.origin+location.pathname,allow_google_signals:false,allow_ad_personalization_signals:false});`
}
export function googleAnalyticsScriptHash(id: string): string {
  return 'sha256-' + sha256Base64(googleAnalyticsBootstrap(id))
}
export function googleAnalyticsTags(id: string): string {
  return (
    '<script async src="https://www.googletagmanager.com/gtag/js?id=' +
    id +
    '"></script><script>' +
    googleAnalyticsBootstrap(id) +
    '</script>'
  )
}
