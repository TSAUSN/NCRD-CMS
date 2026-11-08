'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError, fromSqlError } from '@cms/domain'
import { currentSession } from '../../../../lib/session.ts'
import { createStoryDraft, type NewStoryInput } from '../../../../lib/stories-create.ts'
import { getStoryListState } from '../../../../lib/stories-workspace.ts'
import { getSite } from '../../../../lib/queries.ts'
import { patchStoryList } from '../../../../lib/story-list-commands.ts'
import type { StoryListPatch } from '@cms/schema'
import { addWorldToPage, addSplitToPage, storyWidgetPages } from '../../../../lib/story-widget-add.ts'
import { saveStoryDetails, type StoryEditInput } from '../../../../lib/stories-edit.ts'
export async function saveStory(
  siteId: string,
  collectionId: string,
  entryId: string,
  revision: string,
  input: StoryEditInput,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before saving.' }
  try {
    const saved = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      saveStoryDetails(client, siteId, collectionId, entryId, revision, input),
    )
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    revalidatePath('/sites/' + siteId + '/content')
    return { ok: true as const, ...saved }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      conflict: domain?.kind === 'stale_revision',
      message:
        domain?.kind === 'stale_revision'
          ? 'Saved Stories changed. Your words are still here. Review the saved changes before saving again.'
          : domain?.kind === 'not_authorized'
            ? 'Your role cannot edit this story.'
            : domain?.kind === 'not_found'
              ? 'This story is unavailable.'
              : domain?.kind === 'invalid_state' && error instanceof DomainError
                ? error.message
                : 'The story could not be saved. Check its fields and try again.',
    }
  }
}

export async function addStory(
  siteId: string,
  collectionId: string,
  revision: string,
  input: NewStoryInput,
  requestId?: string,
) {
  if (!requestId) return { ok: false as const, message: 'Reopen Add story before saving this draft.' }
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before creating a story.' }
  try {
    const created = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      createStoryDraft(client, siteId, collectionId, revision, input, requestId),
    )
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    revalidatePath('/sites/' + siteId + '/pages')
    revalidatePath('/sites/' + siteId + '/content')
    return { ok: true as const, ...created }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain?.kind === 'stale_revision'
          ? 'Another editor changed Stories. Reload before adding your story.'
          : domain?.kind === 'not_authorized'
            ? 'Your role cannot create a story page.'
            : domain?.kind === 'invalid_state' && error instanceof DomainError
              ? error.message
              : 'The story could not be created. Check its fields and try again.',
    }
  }
}

export async function saveStoryListPatch(
  siteId: string,
  collectionId: string,
  entryId: string,
  catalogRevision: string,
  entryRevision: string,
  patch: StoryListPatch,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before saving story tags.' }
  try {
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      patchStoryList(client, siteId, collectionId, entryId, catalogRevision, entryRevision, patch),
    )
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    revalidatePath('/sites/' + siteId + '/publishing')
    revalidatePath('/sites/' + siteId + '/content')
    return { ok: true as const, ...result }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain?.kind === 'stale_revision'
          ? 'Someone else changed Stories. Your queued tag choices have not been saved.'
          : domain?.kind === 'not_authorized'
            ? 'Your role cannot change these stories.'
            : domain?.kind === 'not_found'
              ? 'This story is no longer available.'
              : domain instanceof DomainError && domain.kind === 'invalid_state'
                ? domain.message
                : 'The story changes could not be saved. Your queued choices are still here.',
    }
  }
}

export async function reloadStoryList(siteId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again to reload Stories.' }
  try {
    const site = await getSite(session.principal.userId, siteId)
    if (!site) return { ok: false as const, message: 'Stories is no longer available to your account.' }
    const state = await getStoryListState(session.principal.userId, siteId, site.slug)
    if (!state) return { ok: false as const, message: 'Stories is no longer available.' }
    const { media: _, ...summary } = state
    return { ok: true as const, ...summary }
  } catch {
    return { ok: false as const, message: 'Stories could not be reloaded. Your queued choices are still here.' }
  }
}

export async function loadWorldPages(siteId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again to choose a page.' }
  try {
    return {
      ok: true as const,
      pages: await asUser({ userId: session.principal.userId }, client => storyWidgetPages(client, siteId)),
    }
  } catch {
    return { ok: false as const, message: 'Pages could not be loaded. Try again.' }
  }
}
export async function addWorld(siteId: string, pageId: string, revision: string, input: unknown) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before adding the section.' }
  try {
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      addWorldToPage(client, siteId, pageId, revision, input),
    )
    revalidatePath('/pages/' + pageId)
    revalidatePath('/sites/' + siteId + '/pages')
    return { ok: true as const, ...result }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain?.kind === 'stale_revision'
          ? 'This page changed. Reload the page choices before adding the section.'
          : domain?.kind === 'not_authorized'
            ? 'Your role cannot add sections to this page.'
            : domain instanceof DomainError
              ? domain.message
              : 'The section could not be added. No partial section was saved. Try again.',
    }
  }
}

export async function addSplit(siteId: string, pageId: string, revision: string, input: unknown) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before adding the section.' }
  try {
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      addSplitToPage(client, siteId, pageId, revision, input),
    )
    revalidatePath('/pages/' + pageId)
    revalidatePath('/sites/' + siteId + '/pages')
    return { ok: true as const, ...result }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain?.kind === 'stale_revision'
          ? 'This page changed. Reload the page choices before adding the section.'
          : domain?.kind === 'not_authorized'
            ? 'Your role cannot add sections to this page.'
            : domain instanceof DomainError
              ? domain.message
              : 'The section could not be added. No partial section was saved. Try again.',
    }
  }
}

/** A Story review uses only server-selected owned records and its article page. */
export async function prepareStoryPublication(siteId: string, entryId: string, requestId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before reviewing this story.' }
  try {
    const site = await asUser(
      { userId: session.principal.userId },
      async client =>
        (
          await client.query(
            'SELECT initial_release_required,app.can_publish(id) AS allowed FROM sites WHERE id=$1 AND archived_at IS NULL',
            [siteId],
          )
        ).rows[0],
    )
    if (!site || !site.allowed) throw new DomainError('not_authorized', 'Your role cannot publish this story.')
    if (site.initial_release_required)
      return {
        ok: false as const,
        firstSiteReview: true,
        message: 'This site is still private. Review its first site publication before publishing individual stories.',
      }
    const { storyReleaseSelection } = await import('../../../../lib/story-release.ts')
    const { planSiteRelease } = await import('../../../../lib/releases.ts')
    const selected = await asUser({ userId: session.principal.userId }, client =>
      storyReleaseSelection(client, siteId, entryId),
    )
    const release = await planSiteRelease(session.principal.userId, requestId, siteId, selected)
    revalidatePath('/sites/' + siteId + '/publishing')
    return { ok: true as const, releaseId: release.id }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain instanceof DomainError
          ? domain.message
          : 'The story review could not be prepared. Your saved draft is still available.',
    }
  }
}

export async function prepareStoryCalendarSchedule(
  siteId: string,
  collectionId: string,
  entryId: string,
  revision: string,
  day: string,
  requestId: string,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before scheduling.' }
  try {
    const site = await asUser(
      { userId: session.principal.userId },
      async client =>
        (
          await client.query(
            'SELECT initial_release_required,app.can_publish(id) AS allowed FROM sites WHERE id=$1 AND archived_at IS NULL',
            [siteId],
          )
        ).rows[0],
    )
    if (!site?.allowed) throw new DomainError('not_authorized', 'Your role cannot schedule this story.')
    if (site.initial_release_required)
      return {
        ok: false as const,
        firstSiteReview: true,
        message: 'This site is still private. Review its first site publication before scheduling individual stories.',
      }
    const { schedulingAvailable } = await import('../../../../lib/scheduling.ts')
    if (!(await schedulingAvailable(session.principal.userId)))
      throw new DomainError(
        'invalid_state',
        'Scheduling is off. Ask an administrator to check that automatic publishing is running.',
      )
    const { saveStoryCalendarDay } = await import('../../../../lib/story-calendar-commands.ts')
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      saveStoryCalendarDay(client, siteId, collectionId, entryId, revision, day),
    )
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    return await prepareStoryPublication(siteId, entryId, requestId)
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain instanceof DomainError
          ? domain.message
          : 'The schedule review could not be confirmed. Your saved draft is available; reload Coming up before trying again.',
    }
  }
}

export async function updateStoryWriting(
  siteId: string,
  collectionId: string,
  revision: string,
  entryRevision: string,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before updating Stories.' }
  try {
    const { updateStoriesWriting } = await import('../../../../lib/story-newsroom-commands.ts')
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      updateStoriesWriting(client, siteId, collectionId, revision, entryRevision),
    )
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    return { ok: true as const, ...result }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message: domain instanceof DomainError ? domain.message : 'Stories could not be updated. Saved stories are safe.',
    }
  }
}
export async function saveStoryNewsroomOrder(
  siteId: string,
  collectionId: string,
  revision: string,
  entryRevision: string,
  ids: string[],
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving Newsroom order.' }
  try {
    const { saveNewsroomOrder } = await import('../../../../lib/story-newsroom-commands.ts')
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      saveNewsroomOrder(client, siteId, collectionId, revision, entryRevision, ids),
    )
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    revalidatePath('/sites/' + siteId + '/publishing')
    return { ok: true as const, ...result }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain instanceof DomainError
          ? domain.message
          : 'The order could not be confirmed. Your proposed order is still here. Check the saved order before retrying.',
    }
  }
}

export async function prepareStorySubmission(siteId: string, collectionId: string, entryId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before sending this story for review.' }
  try {
    const { prepareSingleStoryReview } = await import('../../../../lib/story-review.ts')
    return {
      ok: true as const,
      prepared: await asUser({ userId: session.principal.userId }, client =>
        prepareSingleStoryReview(client, siteId, collectionId, entryId),
      ),
    }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain?.kind === 'not_authorized'
          ? 'Your role cannot send this story for review.'
          : domain?.kind === 'not_found'
            ? 'This story or its article is unavailable.'
            : domain instanceof DomainError
              ? domain.message
              : 'The saved story could not be checked. Nothing was sent.',
    }
  }
}
export async function sendStorySubmission(
  siteId: string,
  collectionId: string,
  entryId: string,
  prepared: import('../../../../lib/story-review.ts').StoryReviewPreparation,
  note: string,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before sending this story for review.' }
  try {
    const { submitSingleStoryReview } = await import('../../../../lib/story-review.ts')
    const submitted = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      submitSingleStoryReview(client, siteId, collectionId, entryId, prepared, note),
    )
    revalidatePath('/inbox')
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    revalidatePath('/pages/' + prepared.pageId)
    return { ok: true as const, ...submitted }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain?.kind === 'not_authorized'
          ? 'Your role cannot send this story for review.'
          : domain?.kind === 'not_found'
            ? 'This story or its article is unavailable.'
            : domain instanceof DomainError
              ? domain.message
              : 'The review result could not be confirmed. Your saved story is available. Retry to check the same request.',
    }
  }
}
