import 'server-only'

// Existing callers can import these queries while route loaders move by domain.
export { type SiteRow, type SiteSummaryRow, listSites, getSite } from '../server/queries/sites.ts'
export {
  type PageRow,
  type LinkTarget,
  type DraftRow,
  type PageHistoryRow,
  listPages,
  listArchivedPages,
  listLinkTargets,
  getPage,
  listPageHistory,
  getPageHistoryVersion,
  getDraft,
} from '../server/queries/pages.ts'
export {
  type NavigationPage,
  type NavigationWorkspace,
  getNavigationWorkspace,
  canManageNavigation,
} from '../server/queries/navigation.ts'
export {
  getDraftTheme,
  type ThemeUsage,
  type ThemeWorkspace,
  getThemeWorkspace,
  canManageTheme,
  getPublishedThemeColors,
  getDraftThemeColors,
} from '../server/queries/theme.ts'
export {
  type GlobalElementsPageChoice,
  type GlobalElementHead,
  type FrameComponentChoice,
  type GlobalElementsWorkspace,
  getGlobalElementsWorkspace,
  canManageGlobalElements,
} from '../server/queries/site-frame.ts'
export { listMediaAssets } from '../server/queries/media.ts'
export { getSiteImagePreviews, buildPreview, getSiteShell } from '../server/queries/previews.ts'
export {
  type LibraryEntry,
  listSectionLibrary,
  listSectionUsage,
  listPageSectionVersions,
} from '../server/queries/sections.ts'
export {
  type HeartbeatRow,
  latestHeartbeats,
  type QueueHealthRow,
  jobQueueHealth,
} from '../server/queries/operations.ts'
export { type AuthoringRights, authoringRights, roleLabel, isSuperAdmin } from '../server/queries/access.ts'
