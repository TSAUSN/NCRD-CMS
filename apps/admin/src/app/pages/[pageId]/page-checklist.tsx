'use client'
import { useEffect, useState } from 'react'
import type { ReadinessReport } from '@cms/domain'
import { runReadiness } from '../../actions/page-publish.ts'
import styles from './inspector.module.css'
export function PageChecklist({
  versionId,
  description,
  sectionCount,
}: {
  versionId: string | null
  description: string
  sectionCount: number
}) {
  const [report, setReport] = useState<ReadinessReport | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    setReport(null)
    setError(false)
    if (versionId)
      void runReadiness(versionId)
        .then(value => {
          if (active) setReport(value)
        })
        .catch(() => {
          if (active) setError(true)
        })
    return () => {
      active = false
    }
  }, [versionId])
  const incomplete = Boolean(sectionCount && report?.findings.some(finding => finding.rule === 'empty_page'))
  const images = report?.findings.filter(finding => finding.rule === 'image_without_alt').length ?? 0
  const heading = report && !report.findings.some(finding => ['missing_h1', 'empty_page'].includes(finding.rule))
  return (
    <section className={styles.content} aria-label="Page checklist">
      <h3>Page checklist</h3>
      {error ? (
        <p role="alert">The checklist could not be loaded. Save the draft and reopen Page settings to try again.</p>
      ) : !report ? (
        <p role="status">Checking the saved page…</p>
      ) : (
        <ul className={styles.checklist}>
          <li>
            {incomplete
              ? '○ Finish the list setup to check the main heading'
              : heading
                ? '✓ Has a main heading'
                : '○ Add a main heading'}
          </li>
          <li>
            {incomplete
              ? '○ Finish the list setup to check picture descriptions'
              : images
                ? `○ ${images} ${images === 1 ? 'picture needs' : 'pictures need'} a description`
                : '✓ Pictures have descriptions or are marked decorative'}
          </li>
          <li>
            {description.trim().length >= 120 && description.trim().length <= 160
              ? '✓ Search description length is in the suggested range'
              : `○ Search description: ${description.trim().length} characters; aim for 120–160`}
          </li>
        </ul>
      )}
    </section>
  )
}
