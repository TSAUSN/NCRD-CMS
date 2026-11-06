import { isDeepStrictEqual } from 'node:util'
import type { Queryable } from '@cms/platform'
import { CORE_LIBRARY, compileCoreSection, coreUpsertArguments } from './core-library.ts'
export type CoreInstallResult = {
  created: number
  updated: number
  unchanged: number
  definitions: Map<string, { id: string; version: number }>
}
/** Caller owns the identity-scoped transaction. Writes only through app.*. */
export async function installCoreLibrary(client: Queryable): Promise<CoreInstallResult> {
  const allowed = (await client.query<{ allowed: boolean }>('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed
  if (!allowed) throw new Error('Only a super admin can install the shared section library.')
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cms-r8-core-library',8))")
  const result: CoreInstallResult = { created: 0, updated: 0, unchanged: 0, definitions: new Map() }
  for (const entry of CORE_LIBRARY) {
    const compiled = compileCoreSection(entry)
    if (compiled.problems.length) throw new Error(`${entry.definition.name}: ${compiled.problems.join('; ')}`)
    const current = (
      await client.query<{
        id: string
        name: string
        category: string
        version: number
        render_hash: string
        slots: unknown
      }>(
        `
      SELECT d.id,d.name,d.category,v.version,v.render_hash,v.slots FROM section_defs d
      JOIN LATERAL (SELECT version,render_hash,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1) v ON true
      WHERE d.scope='global' AND d.slug=$1`,
        [entry.definition.slug],
      )
    ).rows[0]
    if (
      current &&
      current.render_hash === compiled.renderHash &&
      current.name === entry.definition.name &&
      current.category === entry.definition.category &&
      isDeepStrictEqual(current.slots, compiled.slots)
    ) {
      result.unchanged++
      result.definitions.set(entry.definition.slug, { id: current.id, version: current.version })
      continue
    }
    const saved = (
      await client.query<{ section_def_id: string; version: number }>(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        coreUpsertArguments(entry),
      )
    ).rows[0]!
    result[current ? 'updated' : 'created']++
    result.definitions.set(entry.definition.slug, { id: saved.section_def_id, version: saved.version })
  }
  return result
}
