'use client'
import { type ReadinessReport } from '@cms/domain'
import { IconAlert, IconInfo } from '../../../components/icons.tsx'

export function Readiness({ report }: { report: ReadinessReport | null }) {
  if (!report || report.findings.length === 0) return null
  const blocking = report.findings.filter(finding => finding.severity === 'blocking')
  return (
    <>
      <h3>
        {report.findings.some(
          finding => finding.rule === 'broken_internal_link' && finding.message.includes('section that is no longer'),
        )
          ? 'Needs attention'
          : 'Before you publish'}
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {blocking.length === 0
          ? 'Nothing is stopping this page going live. These are worth a look.'
          : `${blocking.length === 1 ? 'One thing has' : `${blocking.length} things have`} to be fixed before this page can go live.`}
      </p>
      <ul className="findings">
        {report.findings.map((finding, i) => (
          <li key={`${finding.rule}-${i}`} className={finding.severity}>
            {finding.severity === 'blocking' ? <IconAlert size={14} /> : <IconInfo size={14} />}
            <span>
              {finding.message}
              {finding.severity === 'advisory' && <span className="muted"> (optional)</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
