'use client'

import { SectionSaved } from '../../../../../components/section-saved.tsx'
import { IconAlert, IconCheck } from '../../../../../components/icons.tsx'
import { PageHeader } from '../../../../../components/shell.tsx'
import { useHtmlSectionDraft, type SectionCreatorProps } from './use-html-section-draft.ts'
import { SectionMarkup } from './section-markup.tsx'
import { SectionIdentity } from './section-identity.tsx'
import { SectionFields } from './section-fields.tsx'
import { SectionCompilePreview } from './section-compile-preview.tsx'
const STEPS = ['Write the markup', 'Name the fields', 'Check the preview', 'Save'] as const

export function SectionCreator(props: SectionCreatorProps) {
  const { siteId, siteName, initial, modeSwitch = null, appearance = null, previewContext = 'published' } = props
  const model = useHtmlSectionDraft(props)
  const { saved, placement, createAnother, step, error } = model
  if (saved !== null)
    return (
      <SectionSaved
        siteId={siteId}
        siteName={siteName}
        definitionId={initial?.id}
        placement={placement}
        message={saved}
        onCreateAnother={initial ? undefined : createAnother}
      />
    )
  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'All sites', href: '/' },
          { label: siteName, href: `/sites/${siteId}` },
          { label: 'Sections', href: `/sites/${siteId}/sections` },
          { label: initial ? initial.name : 'New section' },
        ]}
        title={initial ? `Edit ${initial.name} (version ${initial.version})` : 'Create an HTML section'}
        lede={
          <>
            Paste the markup for one band of a page and choose “Organize into blocks” to propose editable fields. You
            can also write <code className="mono">{'{{a-name}}'}</code> to make a field somebody can edit without
            touching any code.
          </>
        }
      />

      {modeSwitch}

      {/* A real sequence, so numbering it says something true: each step is
          only reachable once the one before it has produced something. */}
      <ol className="steps" aria-label="Steps">
        {STEPS.map((label, i) => {
          const n = i + 1
          const state = step === n ? 'on' : step > n ? 'done' : ''
          return (
            <li key={label} className={state} aria-current={step === n ? 'step' : undefined}>
              <span className="step-n" aria-hidden="true">
                {step > n ? <IconCheck size={11} /> : n}
              </span>
              {label}
            </li>
          )
        })}
      </ol>

      {error && (
        <p className="notice notice-error" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{error}</span>
        </p>
      )}
      {initial?.cssPolicyVersion === null && (
        <p className="notice notice-warn">
          This older section has unlabelled stylesheet provenance. Check its styles in the preview before saving a new
          version.
        </p>
      )}

      <div className="creator">
        <div>
          <SectionMarkup model={model} />
          <SectionIdentity model={model} siteName={siteName} initial={initial} rights={props.rights}>
            <SectionFields model={model} />
          </SectionIdentity>
        </div>
        <SectionCompilePreview model={model} appearance={appearance} previewContext={previewContext} />
      </div>
    </>
  )
}
