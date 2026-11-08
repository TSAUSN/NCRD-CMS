import { deepEqual, type EditorSection } from '@cms/domain'
export function isSharedChapterPart(section: EditorSection | undefined): boolean {
  return ['what', 'join', 'about', 'faq', 'jumps'].includes(String(section?.values.__cms_chapter_part ?? ''))
}
export function preservesSharedChapterParts(
  original: readonly EditorSection[],
  next: readonly EditorSection[],
): boolean {
  return original.every(
    (section, index) =>
      !isSharedChapterPart(section) ||
      (deepEqual(section, next[index]) &&
        next.filter(item => item.values.__cms_chapter_part === section.values.__cms_chapter_part).length === 1),
  )
}

/** The reviewed chapter jump links are generated from page sections. */
export function isManagedChapterJumpLinks(
  section: EditorSection | undefined,
  definitions: readonly { section_def_id: string; slug?: string }[],
): boolean {
  return Boolean(
    section &&
    definitions.some(def => def.section_def_id === section.section_def_id && def.slug === 'core-echelon-jump-links'),
  )
}
