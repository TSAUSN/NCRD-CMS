import type { ReleaseItem } from './releases.ts'
import { releaseGroup } from './release-copy.ts'
export type InitialReleasePick = { pages: string[]; siteLook: boolean; lists: boolean }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A navigation hint only: RLS, current heads and release commands still decide. */
export function initialReleasePick(pages: unknown, siteLook: unknown, lists: unknown): InitialReleasePick | undefined {
  if (pages === undefined || pages === null) return undefined
  if (typeof pages !== 'string') return { pages: [], siteLook: false, lists: false }
  return {
    pages: [...new Set(pages.split(',').filter(id => uuid.test(id)))].slice(0, 100),
    siteLook: siteLook === '1',
    lists: lists === '1',
  }
}
export function selectedReleaseKeys(
  items: ReleaseItem[],
  canAdminister: boolean,
  area?: string,
  pick?: InitialReleasePick,
): string[] {
  return items
    .filter(
      item =>
        (!item.requiresAdmin || canAdminister) &&
        (pick
          ? item.type === 'page'
            ? pick.pages.includes(item.id)
            : item.type === 'chapter_setup'
              ? false
              : releaseGroup(item) === 'Site look'
                ? pick.siteLook
                : releaseGroup(item) === 'Lists' && pick.lists
          : area === 'header-menu'
            ? item.type === 'navigation' || item.type === 'frame'
            : area === 'footer'
              ? item.type === 'frame'
              : area !== 'site-look' || releaseGroup(item) === 'Site look'),
    )
    .map(item => item.key)
}
