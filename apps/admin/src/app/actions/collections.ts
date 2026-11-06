'use server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { CollectionDraftBatch, CollectionModel, CollectionStableKey } from '@cms/schema'
import { ActionResult, requireSession, toActionResult } from '../../lib/action-result.ts'

export type CollectionCreateResult =
  | {
      ok: true
      collectionId: string
      schemaVersionId: string
      revision: number
      entryRevision: number
      message: string
    }
  | Exclude<ActionResult, { ok: true }>

function collectionActionError(error: unknown): Exclude<ActionResult, { ok: true }> {
  const result = toActionResult(error)
  return result.kind === 'conflict'
    ? {
        ...result,
        message:
          'Someone else saved this list while you were editing. Your work is still here. Reload to compare their changes before saving again.',
      }
    : result
}

function parseCollectionModelForm(
  formData: FormData,
):
  | { ok: true; model: ReturnType<typeof CollectionModel.parse> }
  | { ok: false; result: Exclude<ActionResult, { ok: true }> } {
  let raw: unknown
  try {
    raw = JSON.parse(String(formData.get('model') ?? ''))
  } catch {
    return {
      ok: false,
      result: {
        ok: false,
        kind: 'error',
        message: 'The list fields could not be read. Reopen List settings and try again.',
      },
    }
  }
  const parsed = CollectionModel.safeParse(raw)
  return parsed.success
    ? { ok: true, model: parsed.data }
    : {
        ok: false,
        result: {
          ok: false,
          kind: 'error',
          message: parsed.error.issues[0]?.message ?? 'Check the list fields and try again.',
        },
      }
}

/** Create the collection and its first immutable schema version atomically. */
export async function createCollection(formData: FormData): Promise<CollectionCreateResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const slug = String(formData.get('slug') ?? '').trim()
  const readerKey = String(formData.get('readerKey') ?? '').trim()
  const parsed = parseCollectionModelForm(formData)
  if (!parsed.ok) return parsed.result
  if (!CollectionStableKey.safeParse(slug).success) {
    return { ok: false, kind: 'error', message: 'Use lowercase words separated by hyphens for the collection address.' }
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(readerKey)) {
    return {
      ok: false,
      kind: 'error',
      message: 'The stable reader key must start with a letter and use lowercase letters, numbers or underscores.',
    }
  }
  if (!name || name.length > 120) {
    return { ok: false, kind: 'error', message: 'Give the list a name between 1 and 120 characters.' }
  }
  try {
    const row = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<{
            collection_id: string
            schema_version_id: string
            revision: string
            entry_revision: string
          }>('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
            siteId,
            slug,
            name,
            readerKey,
            JSON.stringify(parsed.model.fields),
            JSON.stringify(parsed.model.presentation),
          ])
        ).rows[0]!,
    )
    revalidatePath(`/sites/${siteId}/content`)
    return {
      ok: true,
      collectionId: row.collection_id,
      schemaVersionId: row.schema_version_id,
      revision: Number(row.revision),
      entryRevision: Number(row.entry_revision),
      message: `“${name}” was created as a private draft.`,
    }
  } catch (error) {
    return collectionActionError(error)
  }
}

export async function saveCollectionSchema(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const collectionId = String(formData.get('collectionId') ?? '')
  const expectedRevision = Number(formData.get('revision'))
  const parsed = parseCollectionModelForm(formData)
  if (!parsed.ok) return parsed.result
  try {
    const row = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<{ schema_version_id: string; revision: string }>(
            'SELECT * FROM app.save_collection_schema($1,$2,$3,$4)',
            [
              collectionId,
              expectedRevision,
              JSON.stringify(parsed.model.fields),
              JSON.stringify(parsed.model.presentation),
            ],
          )
        ).rows[0]!,
    )
    revalidatePath(`/sites/${siteId}/content`)
    return {
      ok: true,
      revision: Number(row.revision),
      versionId: row.schema_version_id,
      message: 'List fields saved as a draft. Publish the field changes before putting updated items live.',
    }
  } catch (error) {
    return collectionActionError(error)
  }
}

export async function publishCollectionSchema(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const collectionId = String(formData.get('collectionId') ?? '')
  const expectedRevision = Number(formData.get('revision'))
  try {
    const row = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<{ schema_version_id: string; revision: string }>(
            'SELECT * FROM app.publish_collection_schema($1,$2)',
            [collectionId, expectedRevision],
          )
        ).rows[0]!,
    )
    revalidatePath(`/sites/${siteId}/content`)
    revalidatePath('/', 'layout')
    return {
      ok: true,
      revision: Number(row.revision),
      versionId: row.schema_version_id,
      message: 'List fields published. Updated items can now be published.',
    }
  } catch (error) {
    return collectionActionError(error)
  }
}

export async function saveCollectionEntries(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const collectionId = String(formData.get('collectionId') ?? '')
  const expectedRevision = Number(formData.get('entryRevision'))
  let raw: unknown
  try {
    raw = JSON.parse(String(formData.get('entries') ?? ''))
  } catch {
    return { ok: false, kind: 'error', message: 'The items could not be read. Reopen this list and try again.' }
  }
  const parsed = CollectionDraftBatch.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      kind: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the item details before saving.',
    }
  }
  try {
    const row = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<{ entry_revision: string }>('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
            collectionId,
            expectedRevision,
            JSON.stringify(parsed.data),
          ])
        ).rows[0]!,
    )
    revalidatePath(`/sites/${siteId}/content`)
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

export async function publishCollectionEntries(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const collectionId = String(formData.get('collectionId') ?? '')
  const expectedRevision = Number(formData.get('entryRevision'))
  try {
    const row = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<{ entry_revision: string; published_count: number }>(
            'SELECT * FROM app.publish_collection_entries($1,$2)',
            [collectionId, expectedRevision],
          )
        ).rows[0]!,
    )
    revalidatePath(`/sites/${siteId}/content`)
    revalidatePath('/', 'layout')
    return {
      ok: true,
      revision: Number(row.entry_revision),
      versionId: null,
      message: `${row.published_count} ${row.published_count === 1 ? 'item is' : 'items are'} now live.`,
    }
  } catch (error) {
    return collectionActionError(error)
  }
}
