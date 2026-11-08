import { SectionSaved } from '../../../../components/section-saved.tsx'
import { PageHeader } from '../../../../components/shell.tsx'
import { useVisualSectionDraft, type VisualSectionProps } from './use-visual-section-draft.ts'
import { VisualSectionFields } from './visual-section-fields.tsx'
import { VisualSectionPreview } from './visual-section-preview.tsx'

export function VisualSectionCreator(props: VisualSectionProps) {
  const { siteId, siteName, rights, initial, previewContext, modeSwitch, appearance } = props
  const model = useVisualSectionDraft(props)
  const { error, saved, placement } = model
  if (saved)
    return (
      <SectionSaved
        siteId={siteId}
        siteName={siteName}
        definitionId={initial?.id}
        placement={placement}
        message={saved}
      />
    )

  return (
    <>
      <PageHeader
        title={initial ? `Edit ${initial.name}` : 'Create a section'}
        crumbs={[
          { label: 'All sites', href: '/' },
          { label: siteName, href: `/sites/${siteId}` },
          { label: 'Sections', href: `/sites/${siteId}/sections` },
          { label: initial ? initial.name : 'New section' },
        ]}
        lede={
          initial
            ? `Editing version ${initial.version}. Saving creates a new version; existing pages stay unchanged.`
            : 'Arrange editable blocks, check the real preview, and make the section available to your site.'
        }
      />
      {modeSwitch}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="creator">
        <VisualSectionFields model={model} siteName={siteName} rights={rights} initial={initial} />
        <VisualSectionPreview
          model={model}
          appearance={appearance}
          previewContext={previewContext}
          editing={Boolean(initial)}
        />
      </div>
    </>
  )
}
