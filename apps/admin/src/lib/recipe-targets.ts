import { asUser } from '@cms/platform'
import type { RecipeTarget } from './recipe-reuse-model.ts'

export async function readRecipeTargets(userId: string, siteId: string | null = null): Promise<RecipeTarget[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<RecipeTarget>(
          `
    SELECT s.id,s.name,app.can_publish(s.id) AS "canCreate",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'revision',p.revision::text) ORDER BY lower(p.title))
        FROM pages p WHERE p.site_id=s.id AND p.archived_at IS NULL),'[]'::jsonb) AS pages,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('readerKey',c.reader_key,'name',c.name,'entries',
        COALESCE((SELECT jsonb_agg(jsonb_build_object('stableKey',e.stable_key,
          'label',COALESCE(v.values->>(schema.sort->>'titleField'),e.stable_key)) ORDER BY e.sort_index)
          FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id
          WHERE e.collection_id=c.id AND e.archived_at IS NULL),'[]'::jsonb)) ORDER BY c.name)
        FROM collections c JOIN collection_schema_versions schema ON schema.id=c.draft_schema_version_id
        WHERE c.site_id=s.id),'[]'::jsonb) AS collections
    FROM sites s WHERE s.status<>'archived' AND ($1::uuid IS NULL OR s.id=$1) ORDER BY s.name`,
          [siteId],
        )
      ).rows,
    { isolation: 'repeatable read' },
  )
}
