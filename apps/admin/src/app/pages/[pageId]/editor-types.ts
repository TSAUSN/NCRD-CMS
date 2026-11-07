import type { EditorDocument, EditorSection, ReadinessReport } from '@cms/domain'
import type { CanonicalInput } from '@cms/renderer'
import type { LibraryEntry, LinkTarget } from '../../../lib/queries.ts'
import type { MediaAsset } from '../../../lib/media-library.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'

export type EditorPane = 'tree' | 'canvas' | 'inspector' | 'library'

export type PageEditorProps = {
  chapterPage?: boolean
  isolatedCanvasOrigin?: string | null
  visitorPreviewOrigin?: string | null
  userId: string
  pageId: string
  siteId: string
  siteName: string
  sitePublicOrigin?: string | null
  originalDesign?: boolean
  pageScoped?: boolean
  lockChapterShared?: boolean
  siteHref: string
  liveHref: string | null
  /** The address shown on the canvas frame's chrome. Decoration, never a link. */
  previewUrl: string
  metadataContext: Omit<CanonicalInput, 'authored'>
  title: string
  revision: number
  /** Exact live version, so saved work and live work cannot share one label. */
  liveSections: EditorSection[]
  publishedVersionId: string | null
  previewVersionId: string | null
  document: EditorDocument
  library: LibraryEntry[]
  pinnedSections: LibraryEntry[]
  linkTargets: LinkTarget[]
  mediaAssets: MediaAsset[]
  imagePreviews?: Record<string, string>
  publishedImagePreviews?: Record<string, string>
  themeColors: Record<string, string>
  draftThemeColors: Record<string, string>
  trustedCodeApproved: boolean
  /** Super admins see the approval control beside the warning, not in a queue. */
  canApproveTrustedCode: boolean
  canAdvanced: boolean
  /** Contributors submit; editors and admins may publish directly. */
  canPublish: boolean
  openReview: { id: string; versionId: string } | null
  latestReviewFeedback: string | null
  initialReadiness: ReadinessReport | null
  initialSitePreview?: SitePreviewContext
  initialField?: string
  initialSettings?: boolean
  initialFocus?: string
  initialSection?: number | null
  initialReleaseRequired?: boolean
}
