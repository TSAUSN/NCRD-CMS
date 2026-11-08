/** Private document metadata only. Storage keys never reach the browser. */
export type SiteDocument = { id: string; originalName: string; bytes: number; url: string; archived?: boolean }
export type ManagedDocument = SiteDocument & { category: string; archived: boolean; revision: number }
export type DocumentLibraryQuery = { search: string; category: string; archived: boolean; page: number }
export type DocumentLibraryResult = { documents: ManagedDocument[]; total: number; categories: string[] }

export const DOCUMENT_LIBRARY_PAGE_SIZE = 50
export const DEFAULT_DOCUMENT_LIBRARY_QUERY: DocumentLibraryQuery = {
  search: '',
  category: '',
  archived: false,
  page: 1,
}

export async function fetchDocuments(siteId: string, query: DocumentLibraryQuery): Promise<DocumentLibraryResult> {
  const params = new URLSearchParams({
    search: query.search,
    category: query.category,
    archived: String(query.archived),
    page: String(query.page),
  })
  const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/documents?${params}`, { cache: 'no-store' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.message || 'The document library could not be loaded.')
  return result as DocumentLibraryResult
}

export async function organizeDocument(
  siteId: string,
  document: Pick<ManagedDocument, 'id' | 'revision' | 'category' | 'archived'>,
): Promise<number> {
  const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/documents`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.error?.message || 'The document change could not be confirmed. Refresh before retrying.')
  return result.revision as number
}

export async function uploadSiteDocument(siteId: string, file: File): Promise<SiteDocument> {
  if (!/\.pdf$/i.test(file.name) || file.size < 1 || file.size > 25 * 1024 * 1024) {
    throw new Error('Choose a PDF file of 25 MB or smaller.')
  }
  const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf', 'x-document-name': encodeURIComponent(file.name) },
    body: file,
  })
  const result = (await response.json()) as { document?: SiteDocument; error?: { message?: string } }
  if (!response.ok || !result.document)
    throw new Error(result.error?.message || 'The document upload could not be confirmed. Try the same file again.')
  if (result.document.archived)
    throw new Error('This PDF is already archived. Restore it in Documents before selecting it again.')
  return result.document
}
