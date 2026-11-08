import { CORE_PAGE_TEMPLATES } from '@cms/seeds/core-templates'
import { Button, Field, SegmentedControl } from '../../../components/ui/index.ts'
import { IconCheck, IconPage, IconPlus, IconSections } from '../../../components/icons.tsx'
import { SectionThumbnail } from '../../../components/section-thumbnail.tsx'
import shared from '../../../components/workspace.module.css'
import selectionControlsStyles from '../../../components/workspace-styles/selection-controls.module.css'
import ownedStyles from './new-page-styles.module.css'
import { NewPageSectionPicker } from './new-page-sections.tsx'
import type { PageSource, PageStartingPoint } from './new-page-draft.ts'

export function NewPageStartingPoint({
  start,
  pages,
  copyPending,
  copyError,
}: {
  start: PageStartingPoint
  pages: PageSource[]
  copyPending: boolean
  copyError: string | null
}) {
  const {
    copyMode,
    mode,
    designs,
    copyId,
    setCopyId,
    library,
    designId,
    setDesignId,
    pageTemplate,
    selectStartingPoint,
    selectTemplate,
    chooseMode,
    chooseSectionsInstead,
    recommended,
  } = start
  const designThumbnail = designs.length ? library.find(entry => entry.slug === 'core-page-header') : undefined
  return (
    <section className={'creator-block ' + ownedStyles.plannerBlock} aria-labelledby="page-start-title">
      <div className="creator-block-head">
        <span className="creator-step">2</span>
        <div>
          <h3 id="page-start-title">Choose a starting point</h3>
          <p>A starter saves setup time. You can move, hide, or remove its sections.</p>
        </div>
      </div>

      <SegmentedControl
        label="Start from"
        value={copyMode ? 'copy' : mode === 'blank' ? 'blank' : 'template'}
        options={[
          { value: 'template', label: 'A template' },
          ...(pages.length ? [{ value: 'copy', label: 'Copy of a page' }] : []),
          { value: 'blank', label: 'Blank page' },
        ]}
        onChange={selectStartingPoint}
      />
      {copyMode ? (
        <div className={shared.stack}>
          <p>The copy keeps the sections and their settings, and starts as a private draft.</p>
          <Field id="copy-source" label="Page to copy">
            <select value={copyId} disabled={copyPending} onChange={event => setCopyId(event.target.value)}>
              <option value="">Choose a page…</option>
              {pages.map(page => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : designs.length > 0 && mode !== 'blank' && mode !== 'custom' ? (
        <>
          <div className={ownedStyles.optionGrid} aria-label="Page designs">
            {designs.map(design => (
              <button
                type="button"
                key={design.id}
                className={selectionControlsStyles.optionCard}
                aria-pressed={designId === design.id}
                onClick={() => setDesignId(design.id)}
              >
                {designThumbnail && <SectionThumbnail entry={designThumbnail} element="span" eager />}
                <strong>{design.title}</strong>
                <small>Existing page design</small>
              </button>
            ))}
          </div>
          <p className="hint">
            These designs copy existing pages in this site's look. Story pages are created in Stories.
          </p>
          <Button variant="tertiary" onClick={chooseSectionsInstead}>
            Choose sections
          </Button>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="page-template">Page template</label>
            <select id="page-template" value={pageTemplate} onChange={event => selectTemplate(event.target.value)}>
              {CORE_PAGE_TEMPLATES.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <div className={ownedStyles.optionGrid} aria-label="Template previews">
            {CORE_PAGE_TEMPLATES.filter(template => ['landing', 'resources', 'event-home'].includes(template.id)).map(
              template => {
                const first = library.find(entry => entry.slug === 'core-' + template.sections[0])
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={selectionControlsStyles.optionCard}
                    aria-pressed={pageTemplate === template.id}
                    onClick={() => selectTemplate(template.id)}
                  >
                    {first && <SectionThumbnail entry={first} element="span" eager />}
                    <strong>{template.name}</strong>
                    <small>
                      {template.sections.length} {template.sections.length === 1 ? 'section' : 'sections'}
                    </small>
                  </button>
                )
              },
            )}
          </div>
          <div className="page-start-options" role="group" aria-label="Page starting point">
            <button
              type="button"
              className={mode === 'starter' ? 'selected' : ''}
              aria-pressed={mode === 'starter'}
              disabled={recommended.length === 0}
              onClick={() => chooseMode('starter')}
            >
              <IconSections size={20} />
              <span>
                <strong>Starter page</strong>
                <small>Recommended · a useful page rhythm</small>
              </span>
              {mode === 'starter' && <IconCheck size={17} />}
            </button>
            <button
              type="button"
              className={mode === 'custom' ? 'selected' : ''}
              aria-pressed={mode === 'custom'}
              disabled={library.length === 0}
              onClick={() => chooseMode('custom')}
            >
              <IconPlus size={20} />
              <span>
                <strong>Choose sections</strong>
                <small>Build the outline yourself</small>
              </span>
              {mode === 'custom' && <IconCheck size={17} />}
            </button>
          </div>

          {mode === 'blank' ? (
            <div className="creator-blank">
              <IconPage size={24} />
              <div>
                <strong>A simple page header</strong>
                <p>Your title and introduction are ready to edit. Add more sections when you need them.</p>
              </div>
            </div>
          ) : (
            <NewPageSectionPicker start={start} />
          )}
        </>
      )}
      {copyError && <p role="alert">{copyError}</p>}
    </section>
  )
}
