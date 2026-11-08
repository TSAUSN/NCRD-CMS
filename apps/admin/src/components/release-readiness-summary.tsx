import type { ReleaseCheck } from '../lib/releases.ts'
import { Badge, Card, Disclosure, TextLink } from './ui/index.ts'
import shared from './workspace.module.css'
import recordTableStyles from './workspace-styles/record-table.module.css'
import siteSummaryStyles from './workspace-styles/site-summary.module.css'

/** The same compact review is used before publishing now or later. */
export function ReleaseReadinessSummary({
  checks,
  releaseId,
  planned,
  canPreview,
  applied,
}: {
  checks: ReleaseCheck[]
  releaseId: string
  planned: boolean
  canPreview: boolean
  applied: boolean
}) {
  const findings = checks.filter(check => check.report.findings.length || !check.report.ok)
  const first = checks[0]
  const preview = (check: ReleaseCheck) =>
    planned && canPreview ? `/releases/${releaseId}/preview/${check.pageId}` : `/preview/${check.versionId}?readonly=1`
  return (
    <div className={shared.stack}>
      <div className={recordTableStyles.summaryAction}>
        <p role="status">
          {checks.length} {checks.length === 1 ? 'page' : 'pages'} checked
          {findings.length
            ? `, ${findings.length} ${findings.length === 1 ? 'page needs' : 'pages need'} attention`
            : checks.length
              ? ', all ready'
              : ''}
        </p>
        {first && (
          <TextLink href={preview(first)} target="_blank" rel="noopener">
            {planned && canPreview ? 'Preview all selected changes' : 'View saved pages'}
          </TextLink>
        )}
      </div>
      {checks.length > 0 && (
        <Disclosure title={`Checked pages (${checks.length})`}>
          <ul className={siteSummaryStyles.rowList}>
            {checks.map(check => (
              <li key={check.pageId}>
                <TextLink href={preview(check)} target="_blank" rel="noopener">
                  {check.title}
                </TextLink>
                {applied && (
                  <TextLink href={`/pages/${check.pageId}/history?version=${check.versionId}`}>
                    Restore this version as a draft
                  </TextLink>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {findings.map(check => (
        <Card
          key={check.pageId}
          title={check.title}
          density="compact"
          headerActions={<Badge tone="pending">Needs attention</Badge>}
        >
          <ul>
            {check.report.findings.length ? (
              check.report.findings.map((finding, index) => (
                <li key={index}>
                  {finding.message} <TextLink href={check.fixLinks?.[index] ?? `/pages/${check.pageId}`}>Fix</TextLink>
                </li>
              ))
            ) : (
              <li>
                Check this page before publishing. <TextLink href={`/pages/${check.pageId}`}>Fix</TextLink>
              </li>
            )}
          </ul>
        </Card>
      ))}
    </div>
  )
}
