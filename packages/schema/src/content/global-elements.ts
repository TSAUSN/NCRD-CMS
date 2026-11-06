import { z } from 'zod'

import { NavTarget, NavUrl } from './nav.ts'

export const GLOBAL_ELEMENT_LIMITS = {
  siteName: 120,
  linkLabel: 80,
  blurb: 500,
  groupHeading: 80,
  contactHeading: 80,
  contactAddress: 300,
  contactEmail: 254,
  contactPhone: 300,
  copyright: 200,
  utilityLinks: 4,
  footerGroups: 4,
  footerGroupLinks: 6,
  socialLinks: 6,
} as const

const SiteName = z.string().trim().max(GLOBAL_ELEMENT_LIMITS.siteName)
const LinkLabel = z.string().trim().min(1).max(GLOBAL_ELEMENT_LIMITS.linkLabel)
const Blurb = z.string().trim().max(GLOBAL_ELEMENT_LIMITS.blurb)
const GroupHeading = z.string().trim().min(1).max(GLOBAL_ELEMENT_LIMITS.groupHeading)
const ContactHeading = z.string().trim().min(1).max(GLOBAL_ELEMENT_LIMITS.contactHeading)
const ContactAddress = z.string().trim().min(1).max(GLOBAL_ELEMENT_LIMITS.contactAddress)
const ContactEmail = z.string().trim().max(GLOBAL_ELEMENT_LIMITS.contactEmail).email()
const ContactPhone = z.string().trim().min(1).max(GLOBAL_ELEMENT_LIMITS.contactPhone)
const Copyright = z.string().trim().max(GLOBAL_ELEMENT_LIMITS.copyright)

export const GlobalElementLink = z
  .object({
    label: LinkLabel,
    target: NavTarget,
  })
  .strict()
export type GlobalElementLink = z.infer<typeof GlobalElementLink>

const HeaderBrandV1 = z
  .object({
    siteName: SiteName,
    showName: z.boolean(),
    logoMediaId: z.uuid().nullable(),
    compactLogoMediaId: z.uuid().nullable(),
    /** Absent in older immutable headers; the renderer keeps their name fallback. */
    logoDescription: z.string().trim().max(300).optional(),
  })
  .strict()

/** A partner named beside the brand, as HNI's “In partnership with …” does
 * (SPEC §6 step 4). Words and an optional web address; no logo yet. */
export const HeaderPartnerV1 = z
  .object({
    label: LinkLabel,
    name: z.string().trim().min(1).max(GLOBAL_ELEMENT_LIMITS.siteName),
    url: NavUrl.nullable(),
  })
  .strict()
export type HeaderPartnerV1 = z.infer<typeof HeaderPartnerV1>

export const HeaderConfigV1 = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    preset: z.enum(['standard', 'centered', 'compact', 'minimal']),
    brand: HeaderBrandV1,
    surface: z.enum(['page', 'soft', 'primary', 'accent', 'transparent']),
    sticky: z.boolean(),
    utilityLinks: z.array(GlobalElementLink).max(GLOBAL_ELEMENT_LIMITS.utilityLinks),
    // Nullable on the wire so the persisted object remains closed and stable.
    cta: GlobalElementLink.nullable(),
    /** Absent from every header saved before it existed (migration 0105). */
    partner: HeaderPartnerV1.nullable().optional(),
  })
  .strict()
  .superRefine((header, context) => {
    if (
      (header.brand.logoMediaId || header.brand.compactLogoMediaId) &&
      Object.hasOwn(header.brand, 'logoDescription') &&
      !header.brand.logoDescription?.trim()
    )
      context.addIssue({
        code: 'custom',
        path: ['brand', 'logoDescription'],
        message: 'Add a description for the logo.',
      })
  })
export type HeaderConfigV1 = z.infer<typeof HeaderConfigV1>

const FooterBrandV1 = z
  .object({
    siteName: SiteName,
    blurb: Blurb,
    showFoundation: z.boolean(),
  })
  .strict()

const FooterLinkGroupV1 = z
  .object({
    heading: GroupHeading,
    links: z.array(GlobalElementLink).max(GLOBAL_ELEMENT_LIMITS.footerGroupLinks),
  })
  .strict()

const FooterContactV1 = z
  .object({
    heading: ContactHeading.optional(),
    address: ContactAddress.optional(),
    email: ContactEmail.optional(),
    phone: ContactPhone.optional(),
  })
  .strict()
  .refine(
    contact => contact.address !== undefined || contact.email !== undefined || contact.phone !== undefined,
    'Contact details must include an address, email, or phone number.',
  )

export const SocialService = z.enum(['facebook', 'instagram', 'youtube', 'linkedin', 'x', 'tiktok'])
export type SocialService = z.infer<typeof SocialService>

const SocialUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine(value => {
    if (/\s|\\/.test(value)) return false
    try {
      const parsed = new URL(value)
      return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
    } catch {
      return false
    }
  }, 'Use an https URL without credentials.')

const FooterSocialLinkV1 = z
  .object({
    service: SocialService,
    url: SocialUrl,
  })
  .strict()

const FooterLegalV1 = z
  .object({
    copyright: Copyright,
    privacy: GlobalElementLink.nullable(),
    accessibility: GlobalElementLink.nullable(),
    terms: GlobalElementLink.nullable(),
  })
  .strict()

export const FooterConfigV1 = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    preset: z.enum(['simple', 'columns', 'contact']),
    brand: FooterBrandV1,
    groups: z.array(FooterLinkGroupV1).max(GLOBAL_ELEMENT_LIMITS.footerGroups),
    contact: FooterContactV1.nullable(),
    social: z.array(FooterSocialLinkV1).max(GLOBAL_ELEMENT_LIMITS.socialLinks),
    legal: FooterLegalV1,
  })
  .strict()
export type FooterConfigV1 = z.infer<typeof FooterConfigV1>

/**
 * A site-frame component (ADR 0010): an authored section definition whose
 * placement is `header` or `footer`, pinned at one version, with the one set of
 * field values the whole site shares. The database checks shape on save and the
 * definition itself (placement, scope, version, trust) on publication.
 */
export const GLOBAL_COMPONENT_VALUES_MAX_BYTES = 131072
export const GlobalComponentRef = z
  .object({
    section_def_id: z.uuid(),
    section_def_version: z.number().int().min(1),
    values: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    component => JSON.stringify(component.values).length <= GLOBAL_COMPONENT_VALUES_MAX_BYTES,
    'Component field values are too large.',
  )
export type GlobalComponentRef = z.infer<typeof GlobalComponentRef>

export const HeaderConfigV2 = z
  .object({
    schemaVersion: z.literal(2),
    enabled: z.boolean(),
    sticky: z.boolean(),
    component: GlobalComponentRef,
  })
  .strict()
export type HeaderConfigV2 = z.infer<typeof HeaderConfigV2>

export const FooterConfigV2 = z
  .object({
    schemaVersion: z.literal(2),
    enabled: z.boolean(),
    component: GlobalComponentRef,
  })
  .strict()
export type FooterConfigV2 = z.infer<typeof FooterConfigV2>

export const HeaderConfig = z.union([HeaderConfigV1, HeaderConfigV2])
export type HeaderConfig = z.infer<typeof HeaderConfig>
/** New authoring requires a description; reading old immutable versions does not. */
export const HeaderDraftConfig = HeaderConfig.superRefine((header, context) => {
  if (
    header.schemaVersion === 1 &&
    (header.brand.logoMediaId || header.brand.compactLogoMediaId) &&
    !header.brand.logoDescription?.trim()
  )
    context.addIssue({ code: 'custom', path: ['brand', 'logoDescription'], message: 'Add a description for the logo.' })
})
export const FooterConfig = z.union([FooterConfigV1, FooterConfigV2])
export type FooterConfig = z.infer<typeof FooterConfig>

export function isAuthoredHeader(config: HeaderConfig): config is HeaderConfigV2 {
  return config.schemaVersion === 2
}
export function isAuthoredFooter(config: FooterConfig): config is FooterConfigV2 {
  return config.schemaVersion === 2
}

export const DEFAULT_HEADER_CONFIG_V1 = {
  schemaVersion: 1,
  enabled: true,
  preset: 'standard',
  brand: {
    siteName: '',
    showName: true,
    logoMediaId: null,
    compactLogoMediaId: null,
  },
  surface: 'page',
  sticky: false,
  utilityLinks: [],
  cta: null,
} as const satisfies HeaderConfigV1

export const DEFAULT_FOOTER_CONFIG_V1 = {
  schemaVersion: 1,
  enabled: true,
  preset: 'simple',
  brand: {
    siteName: '',
    blurb: '',
    showFoundation: true,
  },
  groups: [],
  contact: null,
  social: [],
  legal: {
    copyright: '',
    privacy: null,
    accessibility: null,
    terms: null,
  },
} as const satisfies FooterConfigV1

export const DEFAULT_HEADER_CONFIG = DEFAULT_HEADER_CONFIG_V1
export const DEFAULT_FOOTER_CONFIG = DEFAULT_FOOTER_CONFIG_V1

const LegacyHeaderConfig = z
  .object({
    enabled: z.boolean().optional(),
    preset: z.enum(['standard', 'centered', 'compact', 'minimal']).optional(),
    brand: HeaderBrandV1.partial().optional(),
    surface: z.enum(['page', 'soft', 'primary', 'accent', 'transparent']).optional(),
    sticky: z.boolean().optional(),
    utilityLinks: z.array(GlobalElementLink).max(GLOBAL_ELEMENT_LIMITS.utilityLinks).optional(),
    cta: GlobalElementLink.nullable().optional(),
  })
  .strict()

const LegacyFooterConfig = z
  .object({
    enabled: z.boolean().optional(),
    preset: z.enum(['simple', 'columns', 'contact']).optional(),
    brand: FooterBrandV1.partial().optional(),
    groups: z.array(FooterLinkGroupV1).max(GLOBAL_ELEMENT_LIMITS.footerGroups).optional(),
    contact: FooterContactV1.nullable().optional(),
    social: z.array(FooterSocialLinkV1).max(GLOBAL_ELEMENT_LIMITS.socialLinks).optional(),
    legal: FooterLegalV1.partial().optional(),
  })
  .strict()

function carriesSchemaVersion(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'schemaVersion')
  )
}

function normalizedSiteName(value: string): string | null {
  const parsed = SiteName.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseHeaderConfig(value: unknown): HeaderConfig | null {
  const parsed = HeaderConfig.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseFooterConfig(value: unknown): FooterConfig | null {
  const parsed = FooterConfig.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Upgrades absent and pre-versioned content in memory. Once a stored object
 * claims a schema version it is never repaired: malformed or future-version
 * content fails closed so callers cannot silently publish a different shell.
 */
export function normalizeHeaderConfig(value: unknown, siteName = ''): HeaderConfig | null {
  const fallbackSiteName = normalizedSiteName(siteName)
  if (fallbackSiteName === null) return null

  if (value === null || value === undefined) {
    return HeaderConfigV1.parse({
      ...DEFAULT_HEADER_CONFIG_V1,
      brand: { ...DEFAULT_HEADER_CONFIG_V1.brand, siteName: fallbackSiteName },
    })
  }

  if (carriesSchemaVersion(value)) {
    const parsed = parseHeaderConfig(value)
    if (parsed === null || isAuthoredHeader(parsed) || parsed.brand.siteName !== '' || fallbackSiteName === '')
      return parsed
    return parseHeaderConfig({ ...parsed, brand: { ...parsed.brand, siteName: fallbackSiteName } })
  }

  const legacy = LegacyHeaderConfig.safeParse(value)
  if (!legacy.success) return null
  return parseHeaderConfig({
    ...DEFAULT_HEADER_CONFIG_V1,
    ...legacy.data,
    brand: {
      ...DEFAULT_HEADER_CONFIG_V1.brand,
      siteName: fallbackSiteName,
      ...legacy.data.brand,
    },
  })
}

/** See {@link normalizeHeaderConfig}; footer upgrades obey the same boundary. */
export function normalizeFooterConfig(value: unknown, siteName = ''): FooterConfig | null {
  const fallbackSiteName = normalizedSiteName(siteName)
  if (fallbackSiteName === null) return null

  if (value === null || value === undefined) {
    return FooterConfigV1.parse({
      ...DEFAULT_FOOTER_CONFIG_V1,
      brand: { ...DEFAULT_FOOTER_CONFIG_V1.brand, siteName: fallbackSiteName },
    })
  }

  if (carriesSchemaVersion(value)) {
    const parsed = parseFooterConfig(value)
    if (parsed === null || isAuthoredFooter(parsed) || parsed.brand.siteName !== '' || fallbackSiteName === '')
      return parsed
    return parseFooterConfig({ ...parsed, brand: { ...parsed.brand, siteName: fallbackSiteName } })
  }

  const legacy = LegacyFooterConfig.safeParse(value)
  if (!legacy.success) return null
  return parseFooterConfig({
    ...DEFAULT_FOOTER_CONFIG_V1,
    ...legacy.data,
    brand: {
      ...DEFAULT_FOOTER_CONFIG_V1.brand,
      siteName: fallbackSiteName,
      ...legacy.data.brand,
    },
    legal: { ...DEFAULT_FOOTER_CONFIG_V1.legal, ...legacy.data.legal },
  })
}
