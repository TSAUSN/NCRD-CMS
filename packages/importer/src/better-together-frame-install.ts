import { isDeepStrictEqual } from 'node:util'
import { SiteFileBundle, type SlotDef } from '@cms/schema'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import type { Queryable } from '../../platform/src/publication.ts'

type Head = { revision: number | string; draft_version_id: string }
export type OriginalFrameInstallPlan = {
  definitions: { id: string; version: number; sourceHtml: string; slots: SlotDef[]; name: string }[]
  pages: (Head & { id: string; content: unknown; meta: unknown })[]
  frame: (Head & { kind: 'header' | 'footer'; content: unknown })[]
  menu: Head & { tree: unknown }
  files: Head & { bundle: unknown }
}
/** The caller owns the transaction and reviews the exact conversion. Every
 * checkpoint is compared before writing; only existing app commands mutate it.
 * A complete rerun leaves subsequent editorial drafts untouched. */
export async function installBetterTogetherFrame({
  client,
  siteId,
  plan,
  reviewed,
}: {
  client: Queryable
  siteId: string
  plan: OriginalFrameInstallPlan
  reviewed: boolean
}) {
  if (!reviewed) throw new Error('Review the original menu, footer and file loading choices first.')
  if (!(await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed)
    throw new Error('Only a Super Admin can convert the reviewed site frame.')
  if (!plan.definitions.length || plan.frame.length !== 2 || new Set(plan.frame.map(head => head.kind)).size !== 2)
    throw new Error('Review both original frame parts together.')
  const bundle = SiteFileBundle.parse(plan.files.bundle)
  if (!bundle.original?.newPages) throw new Error('Review the original new-page frame before installation.')
  await client.query('SELECT app.lock_release_site($1)', [siteId])
  const definitions = new Map<
    string,
    { slug: string; site_id: string; scope: string; version: number; source_html: string; slots: unknown }
  >()
  for (const next of plan.definitions) {
    const def = (
      await client.query(
        'SELECT d.slug,d.site_id,d.scope,v.version,v.source_html,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1 ORDER BY v.version DESC LIMIT 1',
        [next.id],
      )
    ).rows[0]
    if (!def || def.site_id !== siteId || def.scope !== 'site')
      throw new Error('An original section is missing or belongs to another site.')
    definitions.set(next.id, def)
  }
  const files = (
    await client.query(
      'SELECT h.revision,h.draft_version_id,v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
      [siteId],
    )
  ).rows[0]
  const installed = plan.definitions.every(next => {
    const def = definitions.get(next.id)!
    return def.version > next.version && def.source_html === next.sourceHtml && isDeepStrictEqual(def.slots, next.slots)
  })
  if (
    installed &&
    bundle.original.definitions.every(pin =>
      files?.bundle.original?.definitions.some((saved: { section_def_id: string; section_def_version: number }) =>
        isDeepStrictEqual(saved, pin),
      ),
    ) &&
    isDeepStrictEqual(files?.bundle.original?.newPages, bundle.original.newPages)
  )
    return { installed: false, definitions: plan.definitions.length }
  const same = (actual: Head | undefined, expected: Head) =>
    actual &&
    String(actual.revision) === String(expected.revision) &&
    actual.draft_version_id === expected.draft_version_id
  if (!same(files, plan.files))
    throw new Error('The reviewed files changed after review. Keep the draft and review again.')
  for (const head of plan.frame) {
    const actual = (
      await client.query('SELECT revision,draft_version_id FROM global_elements WHERE site_id=$1 AND kind=$2', [
        siteId,
        head.kind,
      ])
    ).rows[0]
    if (!same(actual, head))
      throw new Error('The original frame changed after review. Keep the draft and review again.')
  }
  const menu = (await client.query('SELECT revision,draft_version_id FROM navigations WHERE site_id=$1', [siteId]))
    .rows[0]
  if (!same(menu, plan.menu)) throw new Error('The menu changed after review. Keep the draft and review again.')
  for (const page of plan.pages) {
    const actual = (
      await client.query(
        'SELECT revision,draft_version_id FROM pages WHERE site_id=$1 AND id=$2 AND archived_at IS NULL',
        [siteId, page.id],
      )
    ).rows[0]
    if (!same(actual, page)) throw new Error('An original page changed after review. Keep the draft and review again.')
  }
  const compiled = plan.definitions.map(next => {
    if (definitions.get(next.id)!.version !== next.version) throw new Error('An original section changed after review.')
    const result = compileSection({
      sourceHtml: next.sourceHtml,
      slots: next.slots,
      scopeSelector: sectionScopeSelector(definitions.get(next.id)!.slug)!,
    })
    if (result.blocking.length || result.problems.length || result.carriesTrustedCode)
      throw new Error('The original frame must pass the shared sanitizer.')
    return result
  })
  for (const [i, next] of plan.definitions.entries()) {
    const result = compiled[i]!
    const def = definitions.get(next.id)!
    const saved = (
      await client.query(
        'SELECT section_def_id,version FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          def.slug,
          next.name,
          'Better Together',
          next.sourceHtml,
          '',
          result.css,
          JSON.stringify(result.ast),
          JSON.stringify(next.slots),
          result.renderHash,
          result.ast.policyVersion,
          result.ast.cssPolicyVersion,
          'Editable original menu and footer; reviewed file bytes unchanged',
          false,
          'legacy',
          null,
          null,
          'site',
          siteId,
        ],
      )
    ).rows[0]!
    if (saved.section_def_id !== next.id || Number(saved.version) !== next.version + 1)
      throw new Error('The original section changed during conversion.')
  }
  const header = plan.frame.find(head => head.kind === 'header')!
  const footer = plan.frame.find(head => head.kind === 'footer')!
  await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
    siteId,
    header.revision,
    footer.revision,
    JSON.stringify(header.content),
    JSON.stringify(footer.content),
  ])
  await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
    siteId,
    plan.menu.revision,
    JSON.stringify(plan.menu.tree),
    'manual',
  ])
  for (const page of plan.pages)
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      page.id,
      page.revision,
      JSON.stringify(page.content),
      JSON.stringify(page.meta),
      'checkpoint',
      'Editable original menu and footer',
    ])
  await client.query('SELECT * FROM app.save_site_file_bundle($1,$2,$3)', [
    siteId,
    plan.files.revision,
    JSON.stringify(bundle),
  ])
  return { installed: true, definitions: plan.definitions.length }
}
