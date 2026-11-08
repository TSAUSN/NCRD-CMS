import type { listArchivedPages } from '../../../lib/queries.ts'
import { Disclosure } from '../../../components/ui/index.ts'
import { PageManagement } from './page-management.tsx'

export function ArchivedPages({ pages }: { pages: Awaited<ReturnType<typeof listArchivedPages>> }) {
  if (!pages.length) return null
  return (
    <Disclosure title={<>Archived pages ({pages.length})</>} className="archived-pages">
      <p>These pages can be restored with their full history.</p>
      <ul className="archived-list">
        {pages.map(page => (
          <li className="archived-row" key={page.id}>
            <div>
              <strong>{page.title}</strong>
              <p>
                <span className="mono">{page.slug ? '/' + page.slug : '/'}</span> · Full history retained
              </p>
            </div>
            <PageManagement
              pageId={page.id}
              title={page.title}
              slug={page.slug}
              revision={page.revision}
              live={false}
              archived
            />
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}
