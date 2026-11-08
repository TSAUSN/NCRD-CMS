import { SectionInstance } from '@cms/schema'
import type { EditorSection } from '@cms/domain'
export type SectionClipboard = { userId: string; siteId: string; copiedAt: number; section: EditorSection }
export const clipboardKey = (userId: string, siteId: string) => 'cms-r8-section-clipboard:' + userId + ':' + siteId
export function readSectionClipboard(
  source: string | null,
  userId: string,
  siteId: string,
  now = Date.now(),
): SectionClipboard | null {
  if (!source || source.length > 2_000_000) return null
  try {
    const value = JSON.parse(source) as SectionClipboard
    const s = value.section
    if (
      value.userId !== userId ||
      value.siteId !== siteId ||
      !Number.isFinite(value.copiedAt) ||
      now - value.copiedAt > 86_400_000 ||
      value.copiedAt > now ||
      !s ||
      !s.values ||
      typeof s.values !== 'object' ||
      Array.isArray(s.values) ||
      !Number.isSafeInteger(s.section_def_version) ||
      !SectionInstance.safeParse(s).success ||
      (s.raw_html !== undefined && typeof s.raw_html !== 'string')
    )
      return null
    return value
  } catch {
    return null
  }
}
