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
