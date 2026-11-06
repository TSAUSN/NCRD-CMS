import { z } from 'zod'

/** Private migration font identities, never arbitrary font CSS or uploaded names. */
export const SITE_FONT_REGISTRY = {
  'trajan-regular': {
    filename: 'TrajanPro3-Regular.otf',
    family: 'Trajan Pro 3',
    weight: 400,
    style: 'normal',
    mimeType: 'font/otf',
    format: 'opentype',
    sha256: 'b258e7ebe568f70dfc384dfe04a2fdaa74eef872cb5c56e0043cfe069ced02bc',
  },
  'proxima-regular': {
    filename: 'ProximaNova-Regular.ttf',
    family: 'Proxima Nova',
    weight: 400,
    style: 'normal',
    mimeType: 'font/ttf',
    format: 'truetype',
    sha256: 'f715d9c3a8a59c2f8079955680d811dfdf069f769d8521d830c85ae3393dc6a8',
  },
  'jenson-regular': {
    filename: 'AJensonPro-Regular.woff2',
    family: 'Adobe Jenson Pro',
    weight: 400,
    style: 'normal',
    mimeType: 'font/woff2',
    format: 'woff2',
    sha256: '68b3689550cac18a2c209785203f7d67922a51064e7b44992156f62b9dc9e611',
  },
  'jenson-italic': {
    filename: 'AJensonPro-It.woff2',
    family: 'Adobe Jenson Pro',
    weight: 400,
    style: 'italic',
    mimeType: 'font/woff2',
    format: 'woff2',
    sha256: 'e70fba59ad76f97a1f4a68020bcc5d1ae4975392b97767029ba0fe3a6c1477e6',
  },
  'jenson-light': {
    filename: 'AJensonPro-Lt.woff2',
    family: 'Adobe Jenson Pro',
    weight: 300,
    style: 'normal',
    mimeType: 'font/woff2',
    format: 'woff2',
    sha256: '9b15b11877c9adf34720d2ef5d8ca2ced9b42807db5c347aa1a6c6be10d9c509',
  },
  'jenson-semibold': {
    filename: 'AJensonPro-Semibold.woff2',
    family: 'Adobe Jenson Pro',
    weight: 600,
    style: 'normal',
    mimeType: 'font/woff2',
    format: 'woff2',
    sha256: '5411c003271a7bf8332019f08a47034a160f4244885cc45fed8291484885d69a',
  },
  'jenson-bold': {
    filename: 'AJensonPro-Bold.woff2',
    family: 'Adobe Jenson Pro',
    weight: 700,
    style: 'normal',
    mimeType: 'font/woff2',
    format: 'woff2',
    sha256: '91a515f88997c48342409aa05288783f951e09f2fbc7aa69b665944d55167c4b',
  },
} as const
export type SiteFontKey = keyof typeof SITE_FONT_REGISTRY
export const SiteFontKey = z.enum(Object.keys(SITE_FONT_REGISTRY) as [SiteFontKey, ...SiteFontKey[]])
export const SiteAssetProvenance = z.strictObject({
  path: z.string().min(1).max(1000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export const SiteAssetRecord = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(['document', 'font']),
    mime_type: z.enum(['application/pdf', 'font/otf', 'font/ttf', 'font/woff2']),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(25 * 1024 * 1024),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    original_name: z.string().min(1).max(255),
    font_key: SiteFontKey.nullable(),
    provenance: SiteAssetProvenance,
    created_at: z.string().datetime({ offset: true }),
  })
  .superRefine((asset, context) => {
    const font = asset.font_key ? SITE_FONT_REGISTRY[asset.font_key] : null
    if (
      asset.provenance.sha256 !== asset.content_hash ||
      (asset.kind === 'document'
        ? asset.mime_type !== 'application/pdf' || font !== null
        : !font || font.mimeType !== asset.mime_type || font.sha256 !== asset.content_hash)
    )
      context.addIssue({ code: 'custom', message: 'Asset type, source checksum and registered font must agree.' })
  })
export type SiteAssetRecord = z.infer<typeof SiteAssetRecord>
