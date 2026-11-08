import 'server-only'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { CollectionDraftBatch } from '@cms/schema'
import { type ActionResult, toActionResult } from '../../lib/action-result.ts'

export function collectionActionError(error: unknown): Exclude<ActionResult, { ok: true }> {
  const result = toActionResult(error)
  return result.kind === 'conflict'
    ? {
        ...result,
        message:
          'Someone else saved this list while you were editing. Your work is still here. Reload to compare their changes before saving again.',
      }
    : result
}

/** Save a private list revision without invalidating the caller's screen. */
export async function saveListEntries({
  actorId,
  collectionId,
  expectedRevision,
  entries,
}: {
  actorId: string
  collectionId: string
  expectedRevision: number
  entries: unknown
}): Promise<ActionResult> {
  const parsed = CollectionDraftBatch.safeParse(entries)
  if (!parsed.success) {
    return {
      ok: false,
      kind: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the item details before saving.',
    }
  }
  try {
    const row = await asUser(
      { userId: actorId, requestId: randomUUID() },
      async client =>
        (
          await client.query<{ entry_revision: string }>('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
            collectionId,
            expectedRevision,
            JSON.stringify(parsed.data),
          ])
        ).rows[0]!,
    )
    return {
      ok: true,
      revision: Number(row.entry_revision),
      versionId: null,
      message: 'List draft saved. The live site is unchanged.',
    }
  } catch (error) {
    return collectionActionError(error)
  }
}
