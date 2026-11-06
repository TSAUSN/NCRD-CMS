import type { StoryEditInput } from './stories-edit.ts'

/** Related region fields are one choice, so recovery never makes mismatched ids. */
export const STORY_DRAFT_GROUPS = [
  { id: 'title', label: 'Title', fields: ['title'] },
  { id: 'summary', label: 'Summary', fields: ['summary'] },
  { id: 'author', label: 'Author', fields: ['author'] },
  { id: 'body', label: 'Story text', fields: ['body', 'body_is_sample'] },
  { id: 'tags', label: 'Main tags', fields: ['tags'] },
  { id: 'regions', label: 'Secondary tags', fields: ['region', 'regions'] },
  { id: 'countries', label: 'Countries', fields: ['countries'] },
  { id: 'published_date', label: 'Story date', fields: ['published_date'] },
  { id: 'photo', label: 'Lead photo and description', fields: ['photo'] },
] as const
export type StoryDraftGroup = (typeof STORY_DRAFT_GROUPS)[number]['id']
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function assign(target: StoryEditInput, source: StoryEditInput, fields: readonly (keyof StoryEditInput)[]) {
  for (const field of fields) (target as unknown as Record<string, unknown>)[field] = source[field]
}
/** Preserve both editors' independent fields; overlapping edits require a choice. */
export function recoverStoryDraft(base: StoryEditInput, local: StoryEditInput, saved: StoryEditInput) {
  const merged = { ...local },
    conflicts: StoryDraftGroup[] = []
  for (const group of STORY_DRAFT_GROUPS) {
    const changed = (value: StoryEditInput) => group.fields.some(field => !same(value[field], base[field]))
    if (!changed(local)) assign(merged, saved, group.fields)
    else if (changed(saved) && group.fields.some(field => !same(local[field], saved[field]))) conflicts.push(group.id)
  }
  return { merged, conflicts }
}
export function chooseStoryDraft(
  recovery: ReturnType<typeof recoverStoryDraft>,
  saved: StoryEditInput,
  choices: Partial<Record<StoryDraftGroup, 'mine' | 'saved'>>,
) {
  if (recovery.conflicts.some(id => !choices[id])) return null
  const merged = { ...recovery.merged }
  for (const group of STORY_DRAFT_GROUPS) if (choices[group.id] === 'saved') assign(merged, saved, group.fields)
  return merged
}
