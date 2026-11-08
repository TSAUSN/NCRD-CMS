import 'server-only'
import { createHash } from 'node:crypto'
import { asUser, type Queryable } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import { replaceImageReferences } from './media-replacement-values.ts'
type ImageReplacementTarget = {
  key: string
  name: string
  area: 'Page' | 'List' | 'Site look'
  href: string
  available: boolean
}
export type ImageReplacementReview = { fingerprint: string; targets: ImageReplacementTarget[] }
type Page = { id: string; title: string; revision: string; content: unknown; meta: unknown }
type Entry = { id: string; stable_key: string; values: unknown }
type List = {
  id: string
  name: string
  revision: string
  draft_schema_version_id: string
  entry_revision: string
  entries: Entry[]
}
type Frame = { id: string; kind: string; revision: string; content: unknown }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function invalid(message: string): never {
  throw new DomainError('invalid_state', message)
}
async function snapshot(client: Queryable, siteId: string, from: string, to: string) {
  if (from === to) invalid('Choose a different image.')
  if (!(await client.query('SELECT id FROM sites WHERE id=$1 AND app.has_site_access(id)', [siteId])).rowCount)
    throw new DomainError('not_found', 'This site is unavailable.')
  const images = (
    await client.query<{ id: string; revision: string; status: string; has_wide: boolean }>(
      `SELECT m.id,m.revision,m.status,(SELECT jsonb_agg(jsonb_build_array(v.id,v.kind,v.width,v.height,v.bytes,v.created_at) ORDER BY v.kind) FROM media_variants v WHERE v.media_id=m.id) AS files,EXISTS(SELECT 1 FROM media_variants v WHERE v.media_id=m.id AND v.kind='wide') AS has_wide FROM media m WHERE m.id=ANY($1::uuid[]) AND (m.site_id=$2 OR m.site_id IS NULL) ORDER BY m.id`,
      [[from, to], siteId],
    )
  ).rows
  if (
    images.length !== 2 ||
    images.some(image => image.status !== 'ready') ||
    !images.find(image => image.id === to)?.has_wide
  )
    invalid('Both images must be available to this site, and the replacement must be ready.')
  const rights = (
    await client.query<{ publish: boolean; super: boolean }>(
      'SELECT app.can_publish($1) AS publish,app.is_super_admin() AS super',
      [siteId],
    )
  ).rows[0]!
  const pages = (
    await client.query<Page>(
      `SELECT p.id,p.title,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=coalesce(p.draft_version_id,p.published_version_id) WHERE p.site_id=$1 AND p.archived_at IS NULL ORDER BY p.id`,
      [siteId],
    )
  ).rows
  const lists = (
    await client.query<Omit<List, 'entries'>>(
      'SELECT id,name,revision,draft_schema_version_id,entry_revision FROM collections WHERE site_id=$1 ORDER BY id',
      [siteId],
    )
  ).rows
  const batches: List[] = []
  for (const list of lists)
    batches.push({
      ...list,
      entries: (
        await client.query<Entry>(
          `SELECT e.id,e.stable_key,v."values" FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id`,
          [list.id],
        )
      ).rows,
    })
  const frames = (
    await client.query<Frame>(
      `SELECT g.id,g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=coalesce(g.draft_version_id,g.published_version_id) WHERE g.site_id=$1 ORDER BY g.kind`,
      [siteId],
    )
  ).rows
  const replace = (value: unknown) => replaceImageReferences(value, from, to)
  const changedPages = pages.filter(page => !same([page.content, page.meta], replace([page.content, page.meta])))
  const changedLists = batches.filter(
    list =>
      !same(
        list.entries.map(entry => entry.values),
        replace(list.entries.map(entry => entry.values)),
      ),
  )
  const changedFrames = frames.filter(frame => !same(frame.content, replace(frame.content)))
  // A content edit must not become a way for an Editor to alter authored code.
  const changesCode = (value: unknown): boolean =>
    Array.isArray(value)
      ? value.some(changesCode)
      : Boolean(
          value &&
          typeof value === 'object' &&
          Object.entries(value).some(([key, child]) =>
            ['raw_html', 'css', 'custom_css'].includes(key) ? !same(child, replace(child)) : changesCode(child),
          ),
        )
  const targets: ImageReplacementTarget[] = [
    ...changedPages.map(page => ({
      key: `page:${page.id}`,
      name: page.title,
      area: 'Page' as const,
      href: `/pages/${page.id}`,
      available: rights.super || !changesCode(page.content),
    })),
    ...changedLists.map(list => ({
      key: `list:${list.id}`,
      name: list.name,
      area: 'List' as const,
      href: `/sites/${siteId}/content?collection=${list.id}`,
      available: true,
    })),
    ...(changedFrames.length
      ? [
          {
            key: 'frame',
            name: 'Header and footer',
            area: 'Site look' as const,
            href: `/sites/${siteId}/design`,
            available: rights.publish && (rights.super || !changedFrames.some(frame => changesCode(frame.content))),
          },
        ]
      : []),
  ]
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([siteId, images, pages, batches, frames, targets]))
    .digest('hex')
  return { fingerprint, targets, changedPages, changedLists, frames, replace }
}
export function reviewImageReplacement(
  userId: string,
  siteId: string,
  from: string,
  to: string,
): Promise<ImageReplacementReview> {
  return mapErrors(() =>
    asUser(
      { userId },
      async client => {
        const plan = await snapshot(client, siteId, from, to)
        return { fingerprint: plan.fingerprint, targets: plan.targets }
      },
      { isolation: 'repeatable read' },
    ),
  )
}
export function applyImageReplacement(
  userId: string,
  siteId: string,
  from: string,
  to: string,
  fingerprint: string,
  keys: string[],
) {
  return mapErrors(() =>
    asUser(
      { userId },
      async client => {
        const plan = await snapshot(client, siteId, from, to)
        if (plan.fingerprint !== fingerprint)
          throw new DomainError(
            'stale_revision',
            'An image or saved item changed. Review the replacement again before saving.',
          )
        if (
          !keys.length ||
          new Set(keys).size !== keys.length ||
          keys.some(key => !plan.targets.some(target => target.key === key && target.available))
        )
          invalid('Choose at least one available destination from the current review.')
        for (const page of plan.changedPages.filter(page => keys.includes(`page:${page.id}`)))
          await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
            page.id,
            page.revision,
            JSON.stringify(plan.replace(page.content)),
            JSON.stringify(plan.replace(page.meta)),
            'checkpoint',
            'Replaced an image in the saved draft',
          ])
        for (const list of plan.changedLists.filter(list => keys.includes(`list:${list.id}`)))
          await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
            list.id,
            list.entry_revision,
            JSON.stringify(
              list.entries.map(entry => ({
                id: entry.id,
                stableKey: entry.stable_key,
                values: plan.replace(entry.values),
              })),
            ),
          ])
        if (keys.includes('frame')) {
          const header = plan.frames.find(frame => frame.kind === 'header')
          const footer = plan.frames.find(frame => frame.kind === 'footer')
          if (!header || !footer) invalid('The header and footer could not be loaded. Try again.')
          await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
            siteId,
            header.revision,
            footer.revision,
            JSON.stringify(plan.replace(header.content)),
            JSON.stringify(plan.replace(footer.content)),
          ])
        }
        return { count: keys.length }
      },
      { isolation: 'repeatable read' },
    ),
  )
}
