import { isDeepStrictEqual } from 'node:util'
import { SiteFileBundle } from '@cms/schema'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import type { Queryable } from '../../platform/src/publication.ts'
import type { BetterTogetherListConversion } from './better-together-lists.ts'

export type BetterTogetherListPlan = BetterTogetherListConversion & {
  pageId: string
  pageRevision: number | string
  originalVersion: string
  index: number
  definitionId: string
  originalDefinitionVersion: number
}
/** Caller owns the transaction. Exact source/page checkpoints are checked
 * before writes; existing lists and drafts are never merged or overwritten.
 * Entry drafts, changed pages and reviewed pins then use the normal release. */
export async function installBetterTogetherLists(input: {
  client: Queryable
  siteId: string
  plans: BetterTogetherListPlan[]
  reviewed: boolean
}) {
  const { client, siteId, plans } = input
  if (!input.reviewed) throw new Error('Review the original list markup and sample records before installation.')
  if (!(await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed)
    throw new Error('Only a Super Admin can convert an original site layout.')
  if (
    plans.length !== 3 ||
    new Set(plans.map(plan => plan.readerKey)).size !== 3 ||
    plans.some(plan => !['speakers', 'sponsors', 'workshops'].includes(plan.readerKey))
  )
    throw new Error('Review all three BT2027 lists together.')
  await client.query('SELECT app.lock_release_site($1)', [siteId])
  const fileHead = (
    await client.query(
      'SELECT h.revision,v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
      [siteId],
    )
  ).rows[0]
  const bundle = SiteFileBundle.parse(fileHead?.bundle)
  if (!bundle.original) throw new Error('The original site layout must be reviewed first.')
  const pages = new Map<
    string,
    { revision: string; draft_version_id: string; content: Record<string, unknown>[]; meta: unknown }
  >()
  const definitions = new Map<
    string,
    {
      slug: string
      name: string
      category: string
      scope: string
      site_id: string
      source_html: string
      slots: unknown
      version: number
    }
  >()
  for (const plan of plans) {
    if (!pages.has(plan.pageId)) {
      const page = (
        await client.query(
          'SELECT p.revision,p.draft_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.id=$2',
          [siteId, plan.pageId],
        )
      ).rows[0]
      if (!page) throw new Error('An original page is missing.')
      pages.set(plan.pageId, page)
    }
    const definition = (
      await client.query(
        'SELECT d.slug,d.name,d.category,d.scope,d.site_id,v.source_html,v.slots,v.version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1 ORDER BY v.version DESC LIMIT 1',
        [plan.definitionId],
      )
    ).rows[0]
    if (!definition || definition.scope !== 'site' || definition.site_id !== siteId)
      throw new Error('The original section belongs to another site.')
    definitions.set(plan.definitionId, definition)
  }
  const existing = (
    await client.query('SELECT id,reader_key FROM collections WHERE site_id=$1 AND reader_key=ANY($2::text[])', [
      siteId,
      plans.map(plan => plan.readerKey),
    ])
  ).rows
  if (existing.length) {
    // A rerun preserves all subsequent list/page drafts. It only recognizes a
    // complete installed conversion, never repairs a partially matching site.
    const complete =
      existing.length === 3 &&
      plans.every(plan => {
        const def = definitions.get(plan.definitionId)!
        const section = pages.get(plan.pageId)!.content[plan.index]
        return (
          def.source_html === plan.sourceHtml &&
          isDeepStrictEqual(def.slots, plan.slots) &&
          section?.section_def_id === plan.definitionId &&
          section.section_def_version === def.version
        )
      })
    if (complete) return { created: [], existing: existing.map(list => list.reader_key) }
    throw new Error('A list with this name already exists. Preserve it and review the conversion again.')
  }
  for (const plan of plans) {
    const page = pages.get(plan.pageId)!
    const definition = definitions.get(plan.definitionId)!
    const section = page.content[plan.index]
    if (
      String(page.revision) !== String(plan.pageRevision) ||
      page.draft_version_id !== plan.originalVersion ||
      definition.version !== plan.originalDefinitionVersion ||
      section?.section_def_id !== plan.definitionId ||
      section.section_def_version !== plan.originalDefinitionVersion
    )
      throw new Error('The original page changed after review. Keep its draft and review the conversion again.')
  }
  const created: { id: string; readerKey: string; items: number }[] = []
  for (const plan of plans) {
    const compiled = compileSection({
      sourceHtml: plan.sourceHtml,
      slots: plan.slots,
      scopeSelector: sectionScopeSelector(definitions.get(plan.definitionId)!.slug)!,
    })
    if (compiled.blocking.length || compiled.problems.length || compiled.carriesTrustedCode)
      throw new Error('The original list layout must pass the shared sanitizer.')
    const list = (
      await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        siteId,
        plan.readerKey,
        plan.name,
        plan.readerKey,
        JSON.stringify(plan.fields),
        JSON.stringify(plan.presentation),
      ])
    ).rows[0]!
    await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [list.collection_id, list.revision])
    await client.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      list.collection_id,
      JSON.stringify(plan.entries),
    ])
    const definition = definitions.get(plan.definitionId)!
    const saved = (
      await client.query(
        'SELECT section_def_id,version FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          definition.slug,
          plan.name,
          'Better Together',
          plan.sourceHtml,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(plan.slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Original BT2027 markup with native list fields',
          false,
          'legacy',
          null,
          null,
          'site',
          siteId,
        ],
      )
    ).rows[0]!
    if (
      saved.section_def_id !== plan.definitionId ||
      Number(saved.version) !== Number(plan.originalDefinitionVersion) + 1
    )
      throw new Error('The original section changed during conversion.')
    const page = pages.get(plan.pageId)!
    const section = page.content[plan.index]!
    page.content[plan.index] = {
      ...section,
      section_def_version: Number(saved.version),
      values: plan.values,
      label: plan.name,
    }
    bundle.original.definitions.push({ section_def_id: plan.definitionId, section_def_version: Number(saved.version) })
    created.push({ id: list.collection_id, readerKey: plan.readerKey, items: plan.entries.length })
  }
  for (const [pageId, page] of pages)
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      pageId,
      page.revision,
      JSON.stringify(page.content),
      JSON.stringify(page.meta),
      'checkpoint',
      'Editable original BT2027 lists',
    ])
  await client.query('SELECT * FROM app.save_site_file_bundle($1,$2,$3)', [
    siteId,
    fileHead!.revision,
    JSON.stringify(SiteFileBundle.parse(bundle)),
  ])
  return { created, existing: [] }
}
