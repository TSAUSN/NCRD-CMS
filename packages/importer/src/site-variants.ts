import { digest, isObject } from './backup.ts'
import { readLiteralTemplateModule } from './literal-module.ts'
import type { V1Definition, V1Slot } from './source.ts'

const VARIANT_SITES: Record<string, string> = {
  humanneedsindex: 'tsa-humanneedsindex',
  echelonsymposium: 'tsa-echelonsymposium',
  'site-host': 'tsa-site-host',
}
export type V1SiteVariant = V1Definition & { sourceSite: string }
export type VariantCensus = { id?: unknown; sites?: unknown; hashes?: unknown }

/** Select exact source-owned declarations, never evaluate site JavaScript or
 * fall back to the generated registry when a site variant is missing. Census
 * hashes must still match: a changed source requires a reviewed new census. */
export function readSiteVariants(
  rows: VariantCensus[],
  definitions: V1Definition[],
  read: (relative: string) => string,
): V1SiteVariant[] {
  if (!rows.length) return []
  const declared = new Map<string, { site: string; hashes: Record<string, unknown>; ids: Set<string> }>()
  const known = new Map(definitions.map(definition => [definition.id, definition]))
  const seen = new Set<string>()
  for (const row of rows) {
    if (
      typeof row.id !== 'string' ||
      !known.has(row.id) ||
      seen.has(row.id) ||
      !Array.isArray(row.sites) ||
      !row.sites.length ||
      !isObject(row.hashes)
    )
      throw new Error('invalid site-variant census entry')
    seen.add(row.id)
    for (const site of row.sites) {
      if (
        typeof site !== 'string' ||
        !Object.hasOwn(VARIANT_SITES, site) ||
        typeof row.hashes[site] !== 'string' ||
        !/^[a-f0-9]{16}$/.test(row.hashes[site])
      )
        throw new Error(`invalid site-variant identity for ${row.id}`)
      const existing = declared.get(site) ?? { site, hashes: {}, ids: new Set<string>() }
      if (existing.ids.has(row.id)) throw new Error('duplicate source site in variant census')
      existing.ids.add(row.id)
      existing.hashes[row.id] = row.hashes[site]
      declared.set(site, existing)
    }
  }
  const result: V1SiteVariant[] = []
  for (const { site, hashes, ids } of [...declared.values()].sort((a, b) => a.site.localeCompare(b.site, 'en'))) {
    const found = new Set<string>()
    for (const file of ['section-templates.js', 'library-sections.js']) {
      const sourcePath = `${VARIANT_SITES[site]}/src/cms/${file}`
      let literals
      try {
        literals = readLiteralTemplateModule(read(sourcePath))
      } catch (error) {
        throw new Error(`${sourcePath}: ${(error as Error).message}`)
      }
      for (const { value, line } of literals) {
        const id = String(value.id)
        if (!ids.has(id)) continue
        if (found.has(id)) throw new Error(`duplicate site template ${site}/${id}`)
        found.add(id)
        const html = String(value.html),
          css = String(value.css)
        if (digest(html).slice(0, 16) !== hashes[id])
          throw new Error(`site-variant census hash mismatch for ${site}/${id}`)
        const slots: V1Slot[] = (value.slots as unknown[]).map(slot => {
          if (
            !isObject(slot) ||
            typeof slot.blockId !== 'string' ||
            typeof slot.editable !== 'string' ||
            typeof slot.label !== 'string' ||
            (slot.role != null && typeof slot.role !== 'string')
          )
            throw new Error(`invalid site slot for ${site}/${id}`)
          return {
            blockId: slot.blockId,
            editable: slot.editable,
            label: slot.label,
            role: typeof slot.role === 'string' ? slot.role : null,
          }
        })
        const base = known.get(id)!
        result.push({
          ...base,
          name: typeof value.name === 'string' ? value.name : base.name,
          category: typeof value.category === 'string' ? value.category : base.category,
          family: typeof value.family === 'string' ? value.family : base.family,
          sites: [site],
          sourceSite: site,
          slots,
          html,
          css,
          sourcePath,
          sourceLine: line,
          htmlSha256: digest(html),
          cssSha256: digest(css),
        })
      }
    }
    for (const id of ids) if (!found.has(id)) throw new Error(`missing source site template ${site}/${id}`)
  }
  return result.sort((a, b) => a.id.localeCompare(b.id, 'en') || a.sourceSite.localeCompare(b.sourceSite, 'en'))
}
