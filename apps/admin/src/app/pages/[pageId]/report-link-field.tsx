'use client'
import { useState, lazy, Suspense } from 'react'
import { LinkSettings } from '../../../components/link-settings.tsx'
import { Button } from '../../../components/ui/button.tsx'
const DocumentPickerDialog = lazy(async () => ({
  default: (await import('../../sites/[siteId]/content/document-picker-dialog.tsx')).DocumentPickerDialog,
}))
import type { LinkTarget } from '../../../lib/queries.ts'
function pdfName(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const name = decodeURIComponent(new URL(value, 'https://example.invalid').pathname.split('/').at(-1) ?? '')
    return /\.pdf$/i.test(name) ? name : 'PDF link'
  } catch {
    return 'PDF link'
  }
}
export function ReportLinkField({
  id,
  kind,
  value,
  siteId,
  targets,
  onChange,
  onEditStart,
}: {
  id: string
  kind: 'page' | 'pdf'
  value: unknown
  siteId: string
  targets: LinkTarget[]
  onChange: (value: unknown) => void
  onEditStart?: () => () => void
}) {
  const [picking, setPicking] = useState(false),
    label = kind === 'pdf' ? 'View PDF' : 'View page',
    current = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {},
    fixed = { ...current, label }
  const change = (next: unknown) =>
    onChange({ ...(next && typeof next === 'object' && !Array.isArray(next) ? next : {}), label })
  return (
    <div className="field-stack" role="group" aria-label={kind === 'pdf' ? 'PDF' : 'Web page'}>
      <LinkSettings
        destinationLabel={kind === 'pdf' ? pdfName(current.url) : undefined}
        id={id}
        value={fixed}
        targets={targets}
        onChange={change}
        onEditStart={onEditStart}
        allowedKinds={kind === 'pdf' ? ['website'] : ['page', 'website']}
        destinationOnly
        showLinkOptions
        title={kind === 'pdf' ? 'Change PDF link' : 'Change report page'}
      />
      {kind === 'page' && <p className="hint">Search engines and phones read this version.</p>}
      {kind === 'pdf' && (
        <Button variant="secondary" onClick={() => setPicking(true)}>
          {current.url ? 'Replace PDF' : 'Choose a PDF'}
        </Button>
      )}
      {picking && (
        <Suspense fallback={<p role="status">Opening the PDF picker…</p>}>
          <DocumentPickerDialog
            siteId={siteId}
            documents={[]}
            forPage
            onClose={() => setPicking(false)}
            onUploaded={() => {}}
            onChoose={document => {
              onChange({ ...fixed, url: document.url, newTab: true })
              setPicking(false)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
