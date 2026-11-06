import 'server-only'
import { asUser } from '@cms/platform'
import type { DocumentLibraryQuery, DocumentLibraryResult, ManagedDocument } from './document-library.ts'

export async function listDocuments(
  userId: string,
  siteId: string,
  query: DocumentLibraryQuery,
): Promise<DocumentLibraryResult> {
  return asUser(
    { userId },
    async client => {
      const access = await client.query('SELECT id FROM sites WHERE id=$1', [siteId])
      if (!access.rows.length) throw Object.assign(new Error('Document library unavailable'), { kind: 'not_found' })
      const count = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM site_assets a
      JOIN site_document_metadata m ON m.asset_id=a.id AND m.site_id=a.site_id
      WHERE a.site_id=$1 AND a.kind='document' AND m.archived=$2
        AND (strpos(lower(a.original_name),lower($3))>0 OR strpos(lower(m.category),lower($3))>0)
        AND ($4='' OR m.category=$4)`,
        [siteId, query.archived, query.search, query.category],
      )
      const rows = await client.query<{
        id: string
        original_name: string
        bytes: string
        category: string
        archived: boolean
        revision: string
      }>(
        `
      SELECT a.id,a.original_name,a.bytes,m.category,m.archived,m.revision
      FROM site_assets a JOIN site_document_metadata m ON m.asset_id=a.id AND m.site_id=a.site_id
      WHERE a.site_id=$1 AND a.kind='document' AND m.archived=$2
        AND (strpos(lower(a.original_name),lower($3))>0 OR strpos(lower(m.category),lower($3))>0)
        AND ($4='' OR m.category=$4)
      ORDER BY lower(a.original_name),a.id LIMIT 50 OFFSET $5`,
        [siteId, query.archived, query.search, query.category, (query.page - 1) * 50],
      )
      const categories = await client.query<{ category: string }>(
        `SELECT DISTINCT category FROM site_document_metadata WHERE site_id=$1 AND category<>'' ORDER BY category`,
        [siteId],
      )
      return {
        documents: rows.rows.map(row => ({
          id: row.id,
          originalName: row.original_name,
          bytes: Number(row.bytes),
          url: `/assets/${row.id}`,
          category: row.category,
          archived: row.archived,
          revision: Number(row.revision),
        })),
        total: Number(count.rows[0]!.total),
        categories: categories.rows.map(row => row.category),
      }
    },
    { isolation: 'repeatable read' },
  )
}

export async function organizeDocument(
  userId: string,
  siteId: string,
  document: Pick<ManagedDocument, 'id' | 'revision' | 'category' | 'archived'>,
): Promise<number> {
  return asUser({ userId }, async client =>
    Number(
      (
        await client.query<{ revision: string }>('SELECT app.organize_site_document($1,$2,$3,$4,$5) AS revision', [
          siteId,
          document.id,
          document.revision,
          document.category,
          document.archived,
        ])
      ).rows[0]!.revision,
    ),
  )
}
