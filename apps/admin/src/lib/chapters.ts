import { echelonSiteMedia } from './echelon-media.ts'
import { asUser, type Queryable } from '@cms/platform'
import { ChapterSetup, chapterUsesLinkedPage, PageContent, type SectionInstance } from '@cms/schema'
import { DomainError } from '@cms/domain'
import {
  echelonChapterContent,
  echelonChapterTemplate,
  echelonChapterPhotos,
  withEchelonMedia,
  applyChapterSetup,
} from '@cms/seeds/echelon-chapters'
import { corePageDefinitions } from './core-pages.ts'
export type ChapterRow = {
  id: string
  slug: string
  revision: string
  config: ChapterSetup
  publishedConfig: ChapterSetup | null
  pagePublished: boolean
  pageChanged: boolean
  divisionId: string | null
}
export async function chapterRows(client: Queryable, siteId: string): Promise<ChapterRow[]> {
  const rows = (
    await client.query(
      `SELECT c.id,c.slug,c.revision,a.division_id AS "divisionId",d.config,l.config AS "publishedConfig",p.published_version_id IS NOT NULL AS "pagePublished",p.draft_version_id IS DISTINCT FROM p.published_version_id AS "pageChanged" FROM chapters c JOIN chapter_versions d ON d.id=c.draft_version_id LEFT JOIN chapter_division_assignments a ON a.chapter_id=c.id LEFT JOIN chapter_versions l ON l.id=c.published_version_id LEFT JOIN pages p ON p.site_id=c.site_id AND p.id=(d.config->>'pageId')::uuid WHERE c.site_id=$1 ORDER BY lower(d.config->>'name'),c.id`,
      [siteId],
    )
  ).rows
  return rows.map(row => ({
    ...row,
    config: ChapterSetup.parse(row.config),
    publishedConfig: row.publishedConfig ? ChapterSetup.parse(row.publishedConfig) : null,
  }))
}
export function listChapters(userId: string, siteId: string) {
  return asUser({ userId }, client => chapterRows(client, siteId))
}
export async function saveChapterInTransaction(
  client: Queryable,
  siteId: string,
  id: string | null,
  expected: string,
  slug: string,
  input: unknown,
  boardCount = 4,
  divisionId?: string | null,
): Promise<ChapterRow> {
  let config = ChapterSetup.parse(input)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80)
    throw new DomainError('invalid_state', 'Use a short chapter name with letters and numbers.')
  if (!id && divisionId) {
    if (expected !== '0') throw new DomainError('stale_revision', 'This chapter changed. Reload before saving.')
    const division = (
      await client.query('SELECT id FROM chapter_divisions WHERE id=$1 AND site_id=$2', [divisionId, siteId])
    ).rows[0]
    if (!division) throw new DomainError('not_authorized', 'Choose a division you work with.')
    const created = (
      await client.query('SELECT app.create_division_chapter($1,$2,$3) AS id', [
        divisionId,
        slug,
        JSON.stringify(config),
      ])
    ).rows[0]!.id
    const row = (await chapterRows(client, siteId)).find(row => row.id === created)!
    return saveChapterInTransaction(client, siteId, created, row.revision, slug, row.config, boardCount)
  }
  const administer =
    (await client.query("SELECT app.site_role($1)='site_admin' AS allowed", [siteId])).rows[0]?.allowed === true
  if (administer) await client.query('SELECT app.lock_release_site($1)', [siteId])
  else if (id) await client.query('SELECT app.lock_chapter_setup($1)', [id])
  else throw new DomainError('not_authorized', 'A site administrator can add a chapter.')
  const site = (await client.query('SELECT chapters_enabled FROM sites WHERE id=$1', [siteId])).rows[0]
  if (!site?.chapters_enabled) throw new DomainError('invalid_state', 'Chapters are not enabled on this site.')
  if (!administer && !(await client.query('SELECT app.can_manage_chapter($1) AS allowed', [id])).rows[0]?.allowed)
    throw new DomainError('not_authorized', 'This chapter is not available to your team.')
  if (id) {
    const head = (await client.query('SELECT revision FROM chapters WHERE site_id=$1 AND id=$2', [siteId, id])).rows[0]
    if (!head) throw new DomainError('not_found', 'Chapter not found.')
    if (head.revision !== expected)
      throw new DomainError('stale_revision', 'This chapter changed. Reload before saving.')
    const existing = (await chapterRows(client, siteId)).find(row => row.id === id)!
    if (config.pageId !== existing.config.pageId)
      throw new DomainError('invalid_state', 'Keep the assigned chapter page. Contact a site administrator to move it.')
  }
  let created = false
  if (!chapterUsesLinkedPage(config.destination) && !config.pageId && id && !administer) {
    const pageId = (await client.query('SELECT app.create_chapter_page($1,$2) AS id', [id, expected])).rows[0]!.id
    const row = (await chapterRows(client, siteId)).find(row => row.id === id)!
    expected = row.revision
    config = { ...config, pageId }
    created = true
  }
  if (!chapterUsesLinkedPage(config.destination) && !config.pageId) {
    config = {
      ...config,
      pageId: (await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, 'chapters/' + slug, config.name]))
        .rows[0]!.id,
    }
    created = true
  }
  if (!administer && id) {
    const assigned = (await chapterRows(client, siteId)).find(row => row.id === id)?.divisionId
    if (divisionId !== undefined && divisionId !== assigned)
      throw new DomainError('not_authorized', 'A site administrator assigns the division.')
  }
  const saved = (
    await client.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
      siteId,
      id,
      expected,
      slug,
      JSON.stringify(config),
    ])
  ).rows[0]!
  if (administer && divisionId !== undefined)
    await client.query('SELECT app.assign_chapter_division($1,$2)', [saved.chapter_id, divisionId])
  if (config.pageId && !chapterUsesLinkedPage(config.destination)) {
    // The narrow chapter/release command already holds the page lock. A direct
    // FOR UPDATE would apply the unrelated whole-site UPDATE policy to this read.
    const page = (
      await client.query(
        'SELECT p.revision,v.content,v.meta FROM pages p LEFT JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1 AND p.site_id=$2',
        [config.pageId, siteId],
      )
    ).rows[0]
    if (!page) throw new DomainError('not_found', 'Chapter page not found.')
    let content: SectionInstance[]
    if (created || !page.content) {
      const definitions = await corePageDefinitions(client)
      const media = await echelonSiteMedia(client, siteId)
      const photos = media && echelonChapterPhotos(media)
      content = photos
        ? echelonChapterTemplate(definitions, photos, config)
        : echelonChapterContent(config, definitions, boardCount).map(section => ({
            ...section,
            values: withEchelonMedia(section.values, media ?? {}),
          }))
    } else content = applyChapterSetup(PageContent.parse(page.content), config)
    await client.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
      config.pageId,
      page.revision,
      JSON.stringify(content),
      JSON.stringify(page.meta ?? { title: config.name, description: '[Chapter description]' }),
      'Chapter setup saved',
    ])
  }
  return (await chapterRows(client, siteId)).find(row => row.id === saved.chapter_id)!
}
export function saveChapter(
  userId: string,
  requestId: string,
  siteId: string,
  id: string | null,
  expected: string,
  slug: string,
  input: unknown,
  divisionId?: string | null,
) {
  return asUser({ userId, requestId }, client =>
    saveChapterInTransaction(client, siteId, id, expected, slug, input, 4, divisionId),
  )
}
export async function ensureChapterDemoPages(client: Queryable, siteId: string): Promise<void> {
  const navigation = (await corePageDefinitions(client)).find(def => def.slug === 'core-on-page-navigation')
  for (const row of await chapterRows(client, siteId)) {
    if (!row.config.pageId && (row.config.destination === 'page' || row.slug === 'rebuilding-sample')) {
      await saveChapterInTransaction(
        client,
        siteId,
        row.id,
        row.revision,
        row.slug,
        row.config,
        row.slug === 'north-texas' ? 16 : row.slug === 'indianapolis' ? 5 : 4,
      )
      continue
    }
    if (!row.config.pageId || !navigation?.slots.some(slot => slot.id === 'heading')) continue
    const page = (
      await client.query(
        'SELECT p.revision,v.content,v.meta,v.note FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1 AND p.site_id=$2',
        [row.config.pageId, siteId],
      )
    ).rows[0]
    // A deliberate, one-time upgrade of untouched generated drafts only. Never
    // rewrite an authored draft or automatically advance other section pins.
    if (page?.revision !== '1' || page.note !== 'Chapter setup saved') continue
    const content = PageContent.parse(page.content)
    const social = content.find(
      section => section.values.__cms_chapter_part === 'social' && section.section_def_id === navigation.id,
    )
    if (!social || social.section_def_version === navigation.version) continue
    const old = (
      await client.query('SELECT slots FROM section_def_versions WHERE section_def_id=$1 AND version=$2', [
        social.section_def_id,
        social.section_def_version,
      ])
    ).rows[0]
    if (!old || old.slots.some((slot: { id: string }) => slot.id === 'heading')) continue
    const upgraded = content.map(section =>
      section === social ? { ...section, section_def_version: navigation.version } : section,
    )
    await client.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
      row.config.pageId,
      page.revision,
      JSON.stringify(upgraded),
      JSON.stringify(page.meta),
      'Chapter navigation heading updated',
    ])
  }
}

export type ChapterDivision = { id: string; name: string }
export type ChapterTeam = ChapterDivision & { people: { id: string; name: string; email: string; active: boolean }[] }
export function chapterWorkspaceOptions(userId: string, siteId: string) {
  return asUser({ userId }, async client => {
    const divisions = (
      await client.query<ChapterDivision>(
        'SELECT id,name FROM chapter_divisions WHERE site_id=$1 ORDER BY lower(name),id',
        [siteId],
      )
    ).rows
    const row = (
      await client.query<{
        revision: string
        default_update_mode: 'division' | 'chapter-editors'
        checks_enabled: boolean
        review_reminders_enabled: boolean
      }>(
        'SELECT revision,default_update_mode,checks_enabled,review_reminders_enabled FROM chapter_site_settings WHERE site_id=$1',
        [siteId],
      )
    ).rows[0]
    return {
      divisions,
      revision: row?.revision ?? '0',
      defaultMode: row?.default_update_mode ?? ('division' as const),
      checksEnabled: row?.checks_enabled ?? true,
      reviewRemindersEnabled: row?.review_reminders_enabled ?? true,
    }
  })
}
export function chapterTeams(userId: string, siteId: string) {
  return asUser(
    { userId },
    async client =>
      (await client.query<{ teams: ChapterTeam[] }>('SELECT app.chapter_team_feed($1) AS teams', [siteId])).rows[0]
        ?.teams ?? [],
  )
}
