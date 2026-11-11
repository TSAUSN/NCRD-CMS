import { z } from 'zod'
import { DataValues } from './data-values.ts'
import { SocialService } from './global-elements.ts'
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'Remove control characters.')
const socialUrl = plain(2048).refine(value => {
  if (!value) return true
  if (/\s|\\/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}, 'Use an https address without sign-in details.')
export const SiteSocialAccount = z
  .object({
    service: SocialService,
    url: socialUrl,
    handle: plain(100).refine(
      value => !value || /^@?[\p{L}\p{N}._-]+$/u.test(value),
      'Use the account handle,without spaces.',
    ),
    inFooter: z.boolean(),
  })
  .strict()
  .refine(
    value => Boolean(value.url) || (!value.inFooter && !value.handle),
    'Add an account address,or clear its handle and switch In footer off.',
  )
export type SiteSocialAccount = z.infer<typeof SiteSocialAccount>
export const SiteVerificationName = z.enum([
  'google-site-verification',
  'msvalidate.01',
  'yandex-verification',
  'p:domain_verify',
])
export const SiteVerification = z
  .object({
    name: SiteVerificationName,
    content: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9+_:.=\/~\-]+$/),
  })
  .strict()
export type SiteVerification = z.infer<typeof SiteVerification>
export const SiteGeneral = z
  .object({
    description: plain(155),
    country: plain(100),
    language: plain(35).refine(
      value =>
        /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) &&
        (() => {
          try {
            new Intl.Locale(value)
            return true
          } catch {
            return false
          }
        })(),
      'Choose a valid language.',
    ),
    email: z.union([z.literal(''), z.email().max(254)]),
    phone: plain(80),
    address: plain(1000),
  })
  .strict()
export const SiteSearchSharing = z
  .object({
    verification: z
      .array(SiteVerification)
      .max(4)
      .refine(rows => new Set(rows.map(row => row.name)).size === rows.length, 'Use each verification service once.'),
    hints: plain(500),
  })
  .strict()
export const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/
export const SiteAnalytics = z
  .object({
    measurementId: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        value => value === '' || GA4_MEASUREMENT_ID.test(value),
        'Use a GA4 Measurement ID such as G-XXXXXXXXXX.',
      ),
    enabled: z.boolean(),
    includeStaging: z.boolean(),
  })
  .strict()
  .refine(
    value => !value.enabled || GA4_MEASUREMENT_ID.test(value.measurementId),
    'Add the Measurement ID before enabling tracking.',
  )
export type SiteAnalytics = z.infer<typeof SiteAnalytics>

/** Optional blocks preserve legacy public output until the site adopts them. */
export const SitePublicSettings = z
  .object({
    schemaVersion: z.literal(1),
    name: plain(120).min(1),
    dataValues: DataValues.optional(),
    analytics: SiteAnalytics.optional(),
    general: SiteGeneral.optional(),
    search: SiteSearchSharing.optional(),
    social: z
      .array(SiteSocialAccount)
      .max(6)
      .refine(rows => new Set(rows.map(row => row.service)).size === rows.length, 'Use each social account once.')
      .optional(),
  })
  .strict()
export type SitePublicSettings = z.infer<typeof SitePublicSettings>
/** Only quoted,closed verification meta tags are accepted;never arbitrary head HTML. */
export function parseSiteVerificationTags(input: string): SiteVerification[] | null {
  const source = input.trim()
  if (!source) return []
  const tags = source.match(/<meta\b[^<>]*>/gi) ?? []
  if (!tags.length || source.replace(/<meta\b[^<>]*>/gi, '').trim()) return null
  const rows: SiteVerification[] = []
  for (const tag of tags) {
    const match = /^<meta\b([\s\S]*?)\s*\/?>$/i.exec(tag)
    if (!match) return null
    let remaining = match[1]!
    let attrs: Record<string, string> = {}
    while (remaining.trim()) {
      const next = /^\s+([a-z][\w:.-]*)\s*=\s*(['"])(.*?)\2/i.exec(remaining)
      if (!next) return null
      const key = next[1]!.toLowerCase()
      if (!['name', 'content'].includes(key) || Object.hasOwn(attrs, key)) return null
      attrs[key] = next[3]!
      remaining = remaining.slice(next[0].length)
    }
    const parsed = SiteVerification.safeParse({ name: attrs.name?.toLowerCase(), content: attrs.content })
    if (!parsed.success) return null
    rows.push(parsed.data)
  }
  const parsed = SiteSearchSharing.safeParse({ verification: rows, hints: '' })
  return parsed.success ? parsed.data.verification : null
}
export function formatSiteVerificationTags(rows: readonly SiteVerification[]): string {
  return rows.map(row => '<meta name="' + row.name + '" content="' + row.content + '">').join('\n')
}
export const SITE_SOCIAL_LABELS: Record<SiteSocialAccount['service'], string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
}
