import Link from 'next/link'
import { PageHeader } from './shell.tsx'
import { Button, Card } from './ui/index.ts'
/** Keep wayfinding and a single next action after either creator saves. */
export function SectionSaved({
  siteId,
  siteName,
  definitionId,
  placement,
  message,
  onCreateAnother,
}: {
  siteId: string
  siteName: string
  definitionId?: string
  placement: 'page' | 'header' | 'footer'
  message: string
  onCreateAnother?: () => void
}) {
  const canUpdate = Boolean(definitionId) && placement === 'page'
  return (
    <>
      <PageHeader
        title="Section saved"
        crumbs={[
          { label: 'All sites', href: '/' },
          { label: siteName, href: `/sites/${siteId}` },
          { label: 'Sections', href: `/sites/${siteId}/sections` },
          { label: 'Saved' },
        ]}
      />
      <Card
        actions={
          <>
            {canUpdate && (
              <Link className="btn" href={`/sites/${siteId}/sections/${definitionId}/update`}>
                Update pages that use it
              </Link>
            )}
            <Link
              className={canUpdate ? 'btn secondary' : 'btn'}
              href={`/sites/${siteId}/${placement === 'page' ? 'sections' : 'global-elements'}`}
            >
              {placement === 'page' ? 'Back to sections' : 'Choose in Header & footer'}
            </Link>
            {onCreateAnother && (
              <Button variant="secondary" onClick={onCreateAnother}>
                Create another
              </Button>
            )}
          </>
        }
      >
        <p role="status">{message}</p>
      </Card>
    </>
  )
}
