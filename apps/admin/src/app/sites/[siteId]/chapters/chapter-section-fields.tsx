import type { ChapterSetup } from '@cms/schema'
import { Field } from '../../../../components/ui/field.tsx'
import { Note } from '../../../../components/ui/index.ts'
import workspace from '../../../../components/workspace.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { chapterSectionLabels } from './chapter-section-labels.ts'

/** Choose the optional sections a chapter page exposes and how the board appears. */
export function ChapterSectionFields({
  config,
  onSections,
  onBoardDisplay,
}: {
  config: Pick<ChapterSetup, 'destination' | 'sections' | 'boardDisplay'>
  onSections: (sections: ChapterSetup['sections']) => void
  onBoardDisplay: (display: ChapterSetup['boardDisplay']) => void
}) {
  return (
    <>
      {config.destination === 'external' ? (
        <p>The chapter maintains its own website. Page sections apply if a CMS page is added later.</p>
      ) : (
        <>
          <h3 className={workspace.sectionHeading}>Sections on this page</h3>
          <div className={listInspectorStyles.formStack}>
            {Object.entries(chapterSectionLabels).map(([key, label]) => (
              <label className={selectionControlsStyles.checkRow} key={key}>
                <input
                  type="checkbox"
                  checked={config.sections[key as keyof typeof config.sections]}
                  onChange={event => onSections({ ...config.sections, [key]: event.target.checked })}
                  disabled={key === 'socialFirst' && !config.sections.social}
                />
                {label}
              </label>
            ))}
          </div>
          <Field density="compact" id="chapter-board-display" label="Board layout">
            <select
              value={config.boardDisplay}
              onChange={event => onBoardDisplay(event.target.value as ChapterSetup['boardDisplay'])}
            >
              <option value="all">Everyone</option>
              <option value="first-eight">First 8, then Show all</option>
            </select>
          </Field>
          <Note>What is Echelon and Join us are shared sections. Site editors keep them consistent.</Note>
        </>
      )}
    </>
  )
}
