import type { RefObject } from 'react'
import { captureFieldEdit, isSectionNew, isSlotChanged, type EditorState } from '@cms/domain'
import { sampleFieldNames } from '@cms/schema'
import { LinkSettings } from '../../../components/link-settings.tsx'
import { Button, IconButton } from '../../../components/ui/index.ts'
import { IconChevronLeft } from '../../../components/icons.tsx'
import { sectionDisplayName } from '../../../lib/section-display-name.ts'
import type { InspectorProps } from './inspector.tsx'
import shared from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import styles from './inspector.module.css'

type Slots = NonNullable<InspectorProps['entry']>['slots']

export function InspectorSectionTitle({
  inspector,
  props,
  index,
  section,
  slots,
  focusedTitle,
}: {
  inspector: RefObject<HTMLElement | null>
  props: InspectorProps
  index: number
  section: EditorState['document']['sections'][number]
  slots: Slots
  focusedTitle: Slots[number]
}) {
  const { state, entry } = props
  const headingLink = slots.find(slot => ['link', 'button'].includes(slot.kind) && slot.id === 'link')
  const name = sectionDisplayName(section, entry)
  return (
    <aside
      ref={inspector}
      id="editor-panel-inspector"
      data-selected-section
      className={`pane inspector ${styles.inspector} ${workspaceFormsStyles.compactForm}`}
      aria-label="Inspector"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('dialog')) {
          event.preventDefault()
          props.onSelectSlot(null)
        }
      }}
    >
      <div className={shared.denseStack}>
        <div className={workspaceFormsStyles.panelActions}>
          <Button variant="tertiary" onClick={() => props.onSelectSlot(null)}>
            <IconChevronLeft size={16} />
            Back
          </Button>
          <Button onClick={props.onDone}>Done</Button>
        </div>
        <h2>Section title</h2>
        <p className={recordTableStyles.meta}>Part of the {name} section. It moves with the section.</p>
        <div className="field" data-inspector-slot={focusedTitle.id} data-selected="true">
          <div className="field-head">
            <label htmlFor={'slot-' + index + '-' + focusedTitle.id}>Title</label>
            {sampleFieldNames(section.values).includes(focusedTitle.id) && (
              <span className="chip chip-neutral">Sample</span>
            )}
            {!isSectionNew(state, index) && isSlotChanged(state, index, focusedTitle.id) && (
              <IconButton
                variant="tertiary"
                size="s"
                tooltip="Revert Title to the version when you opened this page"
                onClick={() => props.onRevertSlot(focusedTitle.id)}
              >
                <span className="dot" aria-hidden="true" />
              </IconButton>
            )}
          </div>
          <input
            id={'slot-' + index + '-' + focusedTitle.id}
            value={String(section.values[focusedTitle.id] ?? '')}
            onChange={event => props.onChange(focusedTitle.id, event.target.value)}
          />
        </div>
        {headingLink && (
          <LinkSettings
            id={'heading-link-' + index}
            onEditStart={() => {
              const snapshot = captureFieldEdit(section.values, headingLink.id)
              return () => props.onRestoreSlot(headingLink.id, snapshot)
            }}
            summaryLabel="Link beside the title"
            value={section.values[headingLink.id]}
            targets={props.linkTargets}
            onChange={value => props.onChange(headingLink.id, value)}
          />
        )}
      </div>
    </aside>
  )
}
