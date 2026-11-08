import { storySourceCapabilities, type StoriesSettings } from '@cms/schema'
import { reviewTime } from './review-time.ts'
import type { StorySourceCheck } from './story-source-check.ts'
export type StorySourceStatus = { latest: StorySourceCheck | null; lastSuccessAt: string | null }
const stamp = (value: string) => {
  const time = reviewTime(value)
  return time === 'Time unavailable' ? 'at an unknown time' : time
}
export function storySourceStatusLine(source: StoriesSettings['source'], status: StorySourceStatus) {
  if (!storySourceCapabilities(source).canCheck) return 'Public feed not connected'
  if (!status.latest) return 'Feed not checked yet'
  if (status.latest.status === 'checking') return 'Checking feed…'
  if (status.latest.status === 'error')
    return (
      'Feed check failed' +
      (status.lastSuccessAt ? ' · last successful check ' + stamp(status.lastSuccessAt) : ' · saved stories unchanged')
    )
  return 'Feed checked ' + stamp(status.latest.finished_at ?? status.latest.started_at)
}
export function storySourceResult(check: StorySourceCheck) {
  if (check.status === 'checking')
    return 'A story check is already running. Reload Stories in a moment to see its result.'
  if (check.status === 'error')
    return check.result.error === 'format'
      ? 'The feed could not be read safely. Saved stories are unchanged. Check again later.'
      : check.result.error === 'save'
        ? 'The source changes could not be saved. Saved stories are unchanged. Check again.'
        : check.result.error === 'timeout'
          ? 'The check timed out. Saved stories are unchanged. Check again.'
          : 'The feed could not be reached. Saved stories are unchanged. Check again when connected.'
  const n = (key: 'added' | 'updated' | 'removed' | 'preserved') => check.result[key] ?? 0
  return `${n('added')} new ${n('added') === 1 ? 'story' : 'stories'}, ${n('updated')} updated, ${n('removed')} no longer in the feed. Saved as drafts for review.${n('preserved') ? ' ' + n('preserved') + ' CMS text ' + (n('preserved') === 1 ? 'edit kept.' : 'edits kept.') : ''}`
}
