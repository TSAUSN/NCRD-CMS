import { z } from 'zod'
import { SiteOriginalLayout } from './original-layout.ts'

export const SiteFileKind = z.enum(['script', 'stylesheet', 'image', 'font', 'data'])
export type SiteFileKind = z.infer<typeof SiteFileKind>
export const SiteFileName = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const pages = z
  .array(z.uuid())
  .max(500)
  .refine(items => new Set(items).size === items.length, 'Choose each page only once.')
export const SiteScriptBinding = z.strictObject({
  fileId: z.uuid(),
  position: z.enum(['head', 'body-start', 'body-end']),
  loading: z.enum(['normal', 'defer', 'async']),
  pages,
  newPages: z.boolean().optional(),
})
export const SiteStylesheetBinding = z.strictObject({ fileId: z.uuid(), pages, newPages: z.boolean().optional() })
/** Original asset addresses are exact approved paths, never a proxy or a page
 * route. Keep the spelling stable so authored relative URLs remain meaningful. */
export function validSiteFilePath(path: string): boolean {
  if (
    path.length > 2048 ||
    !/^\/(?:[A-Za-z0-9_.~!$&()*+,;=:@/-]|%[0-9a-fA-F]{2})+$/.test(path) ||
    path.includes('//') ||
    /\/(?:\.|\.\.)(?:\/|$)/.test(path) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|2e|2f|5c|7f)/i.test(path)
  )
    return false
  if (!/\.(?:js|css|json|jpe?g|png|gif|webp|svg|ico|woff2?|ttf|otf|eot)$/i.test(path)) return false
  if (/^\/(?:__cms|_next|api|internal|health|robots\.txt|sitemap\.xml)(?:\/|$)/i.test(path)) return false
  try {
    decodeURIComponent(path)
    return new URL(path, 'https://site.invalid').pathname === path
  } catch {
    return false
  }
}
export const SiteFilePath = z.string().refine(validSiteFilePath, 'Use an exact local file address.')
export const SiteFileMount = z.strictObject({ path: SiteFilePath, fileId: z.uuid() })
export type SiteFileMount = z.infer<typeof SiteFileMount>
/** A historical native address maps only to an owned native resource. The
 * original identity is data, never a caller-selected storage path or origin. */
export const SiteNativeVariant = z.enum(['original', 'thumbnail', 'card', 'wide'])
const nativeVariants = z
  .array(SiteNativeVariant)
  .min(1)
  .max(4)
  .refine(items => new Set(items).size === items.length, 'Choose each image size only once.')
export const SiteNativeAlias = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('media'), sourceId: z.uuid(), mediaId: z.uuid(), variants: nativeVariants }),
  z.strictObject({ kind: z.literal('asset'), sourceId: z.uuid(), assetId: z.uuid() }),
])
export type SiteNativeAlias = z.infer<typeof SiteNativeAlias>
export const SiteNativeTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('media'), mediaId: z.uuid(), variant: SiteNativeVariant }),
  z.strictObject({ kind: z.literal('asset'), assetId: z.uuid() }),
])
export type SiteNativeTarget = z.infer<typeof SiteNativeTarget>
export const SiteNativeAliases = z
  .array(SiteNativeAlias)
  .max(2000)
  .refine(
    items => new Set(items.map(item => item.kind + ':' + item.sourceId.toLowerCase())).size === items.length,
    'Choose each original resource only once.',
  )
export function nativeAliasPaths(alias: SiteNativeAlias): string[] {
  return alias.kind === 'asset'
    ? [`/assets/${alias.sourceId}`]
    : alias.variants.map(variant => `/media/${alias.sourceId}/${variant}`)
}
export const SiteFileBundle = z
  .strictObject({
    version: z.literal(1),
    files: z.array(z.uuid()).max(2000),
    scripts: z.array(SiteScriptBinding).max(64),
    styles: z.array(SiteStylesheetBinding).max(64),
    paths: z.array(SiteFileMount).max(2000).optional(),
    native: SiteNativeAliases.optional(),
    original: SiteOriginalLayout.optional(),
  })
  .superRefine((bundle, context) => {
    if (new Set(bundle.files).size !== bundle.files.length)
      context.addIssue({ code: 'custom', message: 'Each site file is listed once.' })
    if (new Set(bundle.paths?.map(item => item.path)).size !== (bundle.paths?.length ?? 0))
      context.addIssue({ code: 'custom', message: 'Each file address is listed once.' })
    for (const item of [...bundle.scripts, ...bundle.styles, ...(bundle.paths ?? [])])
      if (!bundle.files.includes(item.fileId))
        context.addIssue({ code: 'custom', message: 'Every loaded file must belong to this reviewed version.' })
    if ([...bundle.scripts, ...bundle.styles].some(item => item.newPages === true) && !bundle.original?.newPages)
      context.addIssue({
        code: 'custom',
        message: 'Review the original layout for new pages before choosing their files.',
      })
  })
export type SiteFileBundle = z.infer<typeof SiteFileBundle>
export const SiteFileView = z.strictObject({
  id: z.uuid(),
  kind: SiteFileKind,
  name: SiteFileName,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
  source: z.string().min(1).max(2000),
})
export type SiteFileView = z.infer<typeof SiteFileView>
export const SiteFileProjection = z.strictObject({
  versionId: z.uuid(),
  bundle: SiteFileBundle,
  files: z.array(SiteFileView).max(2000),
})
export type SiteFileProjection = z.infer<typeof SiteFileProjection>
export const EMPTY_SITE_FILE_BUNDLE: SiteFileBundle = { version: 1, files: [], scripts: [], styles: [] }

export function siteFileAddress(file: Pick<SiteFileView, 'id' | 'sha256' | 'name'>): string {
  return `/site-files/${file.id}/${file.sha256}/${file.name}`
}

/** The first reviewed original address is the authored base for relative URLs. */
export function siteFileLoadingAddress(
  bundle: SiteFileBundle,
  file: Pick<SiteFileView, 'id' | 'sha256' | 'name'>,
): string {
  return bundle.paths?.find(path => path.fileId === file.id)?.path ?? siteFileAddress(file)
}
