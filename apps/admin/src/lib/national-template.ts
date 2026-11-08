import { isHeroSlides, migrateHeroSlides } from '@cms/schema'
import { nationalTemplateEligibilitySql } from './site-installation-settings.ts'
import { renderPage, type RenderManifest, type SectionDefView } from '@cms/renderer'
import { readSitePreview } from './site-preview.ts'
import { SCRIPTLESS_RENDER_OPTIONS } from './scriptless-preview.ts'
import { createHash } from 'node:crypto'
import { DomainError, type EditorSection } from '@cms/domain'
import { ThemeTokens, type SlotDef } from '@cms/schema'
import type { Queryable } from '@cms/platform'
import { nationalTemplateTheme, NATIONAL_TEMPLATE_VERSION } from '@cms/seeds/core-themes'
import { planSectionUpgrade } from './section-upgrade.ts'

export type NationalSiteReview = {
  id: string
  name: string
  pages: number
  changedPages: string[]
  themeChanged: boolean
  fingerprint: string
  connected: boolean
  mayChangeColours: boolean
}
type PageHead = {
  id: string
  title: string
  revision: string
  version_id: string
  content: EditorSection[]
  meta: unknown
}
async function requireSuper(client: Queryable) {
  if (!(await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed)
    throw new DomainError('not_authorized', 'Only a super admin can manage the national template.')
}
export async function nationalTemplateSites(client: Queryable) {
  await requireSuper(client)
  return (
    await client.query<{ id: string; name: string }>(`SELECT s.id,s.name FROM sites s
 JOIN themes h ON h.site_id=s.id JOIN theme_versions v ON v.id=h.draft_version_id
 WHERE s.archived_at IS NULL AND ${nationalTemplateEligibilitySql('v.tokens')}
 AND NOT EXISTS(SELECT 1 FROM site_file_heads f JOIN site_file_versions fv ON fv.id=f.draft_version_id OR fv.id=f.published_version_id WHERE f.site_id=s.id AND fv.bundle ? 'original') ORDER BY s.name,s.id`)
  ).rows
}
export async function reviewNationalSite(client: Queryable, siteId: string, lock = false) {
  const allowed = await nationalTemplateSites(client)
  const site = allowed.find(site => site.id === siteId)
  if (!site) throw new DomainError('not_found', 'This site does not use the national template.')
  const theme = (
    await client.query<{ revision: string; version_id: string; tokens: unknown }>(
      `SELECT h.revision,v.id AS version_id,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1`,
      [siteId],
    )
  ).rows[0]!
  const pages = (
    await client.query<PageHead>(
      `SELECT p.id,p.title,p.revision,v.id AS version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL ORDER BY p.id${lock ? ' FOR UPDATE OF p' : ''}`,
      [siteId],
    )
  ).rows
  const defs = (
    await client.query<{ id: string; slug: string; version: number; slots: SlotDef[] }>(
      `SELECT d.id,d.slug,v.version,v.slots FROM section_defs d JOIN LATERAL(SELECT version,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.status='active' AND d.slug LIKE 'core-%' ORDER BY d.id`,
    )
  ).rows
  const oldSlots = (
    await client.query<{ section_def_id: string; slug: string; version: number; slots: SlotDef[] }>(
      'SELECT section_def_id,version,slots FROM section_def_versions WHERE section_def_id=ANY($1::uuid[])',
      [defs.map(def => def.id)],
    )
  ).rows
  const latest = new Map(defs.map(def => [def.id, def])),
    slots = new Map(oldSlots.map(def => [def.section_def_id + '@' + def.version, def.slots]))
  const changes = pages.flatMap(page => {
    let changed = false
    const content = page.content.map(section => {
      const target = latest.get(section.section_def_id)
      if (!target || target.version <= section.section_def_version) return section
      const before = slots.get(section.section_def_id + '@' + section.section_def_version)
      if (!before)
        throw new DomainError(
          'invalid_state',
          'A section used by this page is unavailable. Open the page before applying an update.',
        )
      const legacyHero =
        target.slug === 'core-feature-slider' &&
        target.slots.some(isHeroSlides) &&
        !before.some(isHeroSlides) &&
        [1, 2, 3].every(n => before.some(slot => slot.id === 'title' + n))
      const plan = legacyHero
        ? { values: migrateHeroSlides(section.values), removed: [], changed: [] }
        : planSectionUpgrade(before, target.slots, section.values)
      if (plan.removed.length || plan.changed.length)
        throw new DomainError(
          'invalid_state',
          `${page.title}: this update changes content fields. Review it in the page editor first.`,
        )
      changed = true
      return { ...section, section_def_version: target.version, values: plan.values }
    })
    return changed ? [{ page, content }] : []
  })
  const current = ThemeTokens.parse(theme.tokens),
    next = nationalTemplateTheme(current.fonts, current.presentation?.headings === 'small-caps')
  if (current.presentation?.template?.mayChangeColours) {
    next.colors = current.colors
    next.presentation!.template!.mayChangeColours = true
  }
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        theme: [theme.revision, theme.version_id],
        pages: pages.map(page => [page.id, page.revision, page.version_id]),
        defs: defs.map(def => [def.id, def.version]),
        parent: NATIONAL_TEMPLATE_VERSION,
      }),
    )
    .digest('hex')
  const review: NationalSiteReview = {
    id: site.id,
    name: site.name,
    pages: pages.length,
    changedPages: changes.map(change => change.page.title),
    themeChanged: JSON.stringify(current) !== JSON.stringify(next),
    fingerprint,
    connected: current.presentation?.template?.id === 'national',
    mayChangeColours: current.presentation?.template?.mayChangeColours ?? false,
  }
  return { review, theme, next, changes }
}
export async function applyNationalTemplate(client: Queryable, selections: { id: string; fingerprint: string }[]) {
  await requireSuper(client)
  if (
    !selections.length ||
    selections.length > 50 ||
    new Set(selections.map(item => item.id)).size !== selections.length
  )
    throw new DomainError('invalid_state', 'Choose one or more sites to update.')
  let sites = 0,
    pages = 0
  for (const selection of [...selections].sort((a, b) => a.id.localeCompare(b.id))) {
    const plan = await reviewNationalSite(client, selection.id, true)
    if (plan.review.fingerprint !== selection.fingerprint)
      throw new DomainError('stale_revision', 'A site changed after this review. Review the update again.')
    if (plan.review.themeChanged || plan.changes.length)
      await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
        selection.id,
        plan.theme.revision,
        JSON.stringify(plan.next),
      ])
    for (const change of plan.changes) {
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4,$5,$6)', [
        change.page.id,
        change.page.revision,
        JSON.stringify(change.content),
        JSON.stringify(change.page.meta),
        'checkpoint',
        'Applied national template update',
      ])
      pages++
    }
    if (plan.review.themeChanged || plan.changes.length) sites++
  }
  return { sites, pages }
}

/** Render the saved before/after pair through the ordinary sanitizing renderer. */
export async function previewNationalTemplate(client: Queryable, siteId: string) {
  const plan = await reviewNationalSite(client, siteId)
  const page =
    plan.changes[0]?.page ??
    (
      await client.query<PageHead>(
        `SELECT p.id,p.title,p.revision,v.id AS version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL ORDER BY length(p.slug),p.sort_index,p.id LIMIT 1`,
        [siteId],
      )
    ).rows[0]
  if (!page) throw new DomainError('invalid_state', 'Add a page before reviewing this template on the site.')
  const preview = await readSitePreview(client, siteId)
  if (!preview) throw new DomainError('not_found', 'The saved site preview is unavailable.')
  const manifest = (
    await client.query<{ manifest: RenderManifest }>('SELECT app.build_render_manifest($1) AS manifest', [
      page.version_id,
    ])
  ).rows[0]!.manifest
  const render = (manifest: RenderManifest, after = false) =>
    renderPage({
      manifest,
      shell: after ? { ...preview.shell, theme: plan.next } : preview.shell,
      isStaging: true,
      navigationPaths: preview.navigationPaths,
      options: SCRIPTLESS_RENDER_OPTIONS,
    }).html
  const beforeHtml = render(manifest),
    after = structuredClone(manifest),
    change = plan.changes.find(change => change.page.id === page.id)
  if (change)
    for (const [index, section] of change.content.entries()) {
      if (section.section_def_version === page.content[index]!.section_def_version) continue
      const target = (
        await client.query<SectionDefView>(
          `SELECT d.id AS section_def_id,d.slug,v.version,v.compiled_ast,v.compiled_css AS css,v.slots,v.sanitizer_policy_version,v.css_policy_version,v.render_hash,v.definition_kind,v.structured_doc,v.structured_schema_version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1 AND v.version=$2 AND d.scope='global' AND d.status='active'`,
          [section.section_def_id, section.section_def_version],
        )
      ).rows[0]
      if (!target) throw new DomainError('stale_revision', 'This section changed. Review the template again.')
      after.sections[index] = {
        ...after.sections[index]!,
        def: target,
        instance: { ...after.sections[index]!.instance, section_def_version: target.version, values: section.values },
      }
    }
  return { beforeHtml, html: render(after, true), pageTitle: page.title, fingerprint: plan.review.fingerprint }
}
