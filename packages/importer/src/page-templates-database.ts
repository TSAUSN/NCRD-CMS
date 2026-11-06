// Write V1's page templates into a site as page recipes (LIB-09), after its V1
// library (LIB-01). Everything goes through product commands as the operator:
// the sections are saved on one private source page — the existing
// `source-…` convention for imported references — with V1's starting content,
// each template is captured from it with `app.save_page_recipe`, and the
// source page is archived so it does not sit among the site's pages. A rerun
// leaves a recipe of the same name exactly as it is.
import { randomUUID } from 'node:crypto'
import { sourceSampleValues, type SlotDef } from '@cms/schema'
import { librarySlug, type LibrarySite } from './catalogue-library.ts'
import type { ImportClient } from './database.ts'
import { planPageTemplates, type V1PageTemplate } from './page-templates.ts'

export type PageTemplateReport = {
  site: LibrarySite
  created: { name: string; recipeId: string; sections: number }[]
  existing: string[]
  skipped: { name: string; reason: string }[]
}

/** Caller owns a transaction with a super-admin actor (as the migration CLI does). */
export async function importPageTemplates(
  client: ImportClient,
  input: {
    runId: string
    siteId: string
    site: LibrarySite
    templates: readonly V1PageTemplate[]
  },
): Promise<PageTemplateReport> {
  const { runId, siteId, site } = input
  if (!(await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed)
    throw new Error('only a super admin can import V1 page templates')
  if (
    !(
      await client.query('SELECT 1 FROM public.v1_import_targets WHERE run_id=$1 AND site_id=$2 LIMIT 1', [
        runId,
        siteId,
      ])
    ).rows.length
  ) {
    throw new Error('the destination site was not created by this V1 import run')
  }
  const definitions = new Map(
    (
      await client.query(
        `SELECT d.slug, d.id, d.name, v.version, v.slots FROM public.section_defs d
    JOIN LATERAL (SELECT version, slots FROM public.section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1) v ON true
    WHERE d.site_id=$1 AND d.slug LIKE 'v1-lib-%' AND d.status='active'`,
        [siteId],
      )
    ).rows.map(row => [
      String(row.slug),
      { id: String(row.id), name: String(row.name), version: Number(row.version), slots: row.slots as SlotDef[] },
    ]),
  )
  const named = new Set(
    (
      await client.query('SELECT name FROM public.page_recipes WHERE site_id=$1 AND retired_at IS NULL', [siteId])
    ).rows.map(row => String(row.name)),
  )

  const report: PageTemplateReport = { site, created: [], existing: [], skipped: [] }
  const plan = planPageTemplates(input.templates, site, id => librarySlug(site, id), new Set(definitions.keys()))
  const wanted: { name: string; slugs: string[] }[] = []
  for (const entry of plan) {
    if (entry.disposition === 'skipped') {
      report.skipped.push({ name: entry.template.name, reason: entry.reason })
      continue
    }
    if (named.has(entry.template.name)) {
      report.existing.push(entry.template.name)
      continue
    }
    wanted.push({ name: entry.template.name, slugs: entry.slugs })
  }
  if (!wanted.length) return report

  const content = wanted.flatMap(({ slugs }) =>
    slugs.map(slug => {
      const definition = definitions.get(slug)!
      return {
        section_def_id: definition.id,
        section_def_version: definition.version,
        values: sourceSampleValues(definition.slots),
        hidden: false,
        hidden_at: [],
        label: definition.name,
      }
    }),
  )
  const page = String(
    (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        siteId,
        `source-v1-page-templates-${randomUUID().slice(0, 8)}`,
        'V1 page templates (source)',
      ])
    ).rows[0]!.id,
  )
  const saved = (
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [page, JSON.stringify(content), '{}'])
  ).rows[0]!
  let offset = 0
  for (const { name, slugs } of wanted) {
    const selection = slugs.map((_, index) => ({ index: offset + index, sample: true }))
    offset += slugs.length
    const recipeId = String(
      (
        await client.query('SELECT app.save_page_recipe($1,NULL,0,$2,$3,$4) AS id', [
          siteId,
          name,
          saved.version_id,
          JSON.stringify(selection),
        ])
      ).rows[0]!.id,
    )
    report.created.push({ name, recipeId, sections: slugs.length })
  }
  await client.query('SELECT app.archive_page($1,$2)', [page, saved.revision])
  return report
}
