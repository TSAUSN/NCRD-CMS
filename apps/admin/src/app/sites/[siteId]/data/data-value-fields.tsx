import type { DataValue as NumberValue } from '@cms/schema'
import { Field, TextLink, Note } from '../../../../components/ui/index.ts'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import surfaceControlsStyles from '../../../../components/ui/styles/surface-controls.module.css'
import ownedStyles from './workspace-styles.module.css'
import { NUMBER_STATUS_LABELS, type DataValuesModel } from './use-data-values.ts'

export function DataValueFields({ model, selected }: { model: DataValuesModel; selected: NumberValue }) {
  const { select, update, pending, archived, pageLinks } = model
  return (
    <div
      className={shared.denseStack}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          select(null)
        }
      }}
    >
      <Field density="compact" id="data-label" label="What it counts">
        <input
          value={selected.label}
          onChange={event => update('label', event.target.value)}
          maxLength={120}
          disabled={pending || archived}
        />
      </Field>
      {selected.status === 'does-not-change' && (
        <Note>This number doesn’t change. Choose Needs checking or Matches report before editing its value.</Note>
      )}
      <div className={workspaceFormsStyles.formRow}>
        <Field density="compact" id="data-number" label="Value">
          <input
            value={selected.value}
            readOnly={selected.status === 'does-not-change'}
            onChange={event => update('value', event.target.value)}
            maxLength={100}
            disabled={pending || archived}
          />
        </Field>
        <Field density="compact" id="data-as-of" label="As of">
          <input
            value={selected.asOf}
            onChange={event => update('asOf', event.target.value)}
            maxLength={60}
            placeholder="FY2025"
            disabled={pending || archived}
          />
        </Field>
      </div>
      <Field density="compact" id="data-unit" label="Label on the page">
        <input
          value={selected.unit}
          onChange={event => update('unit', event.target.value)}
          maxLength={80}
          disabled={pending || archived}
        />
      </Field>
      <Field
        density="compact"
        id="data-source"
        label="Source"
        help="Required, so the next person knows where it came from."
      >
        <input
          required
          value={selected.source}
          onChange={event => update('source', event.target.value)}
          maxLength={500}
          disabled={pending || archived}
        />
      </Field>
      {selected.sourcePageId && <TextLink href={'/pages/' + selected.sourcePageId}>Open source page</TextLink>}
      <label className={selectionControlsStyles.toggleRow}>
        <span>Show the source in small print</span>
        <input
          type="checkbox"
          role="switch"
          checked={selected.showSource}
          onChange={event => update('showSource', event.target.checked)}
          disabled={pending || archived}
        />
      </label>
      <Field density="compact" id="data-status" label="Status">
        <select
          value={selected.status}
          onChange={event => update('status', event.target.value as NumberValue['status'])}
          disabled={pending || archived}
        >
          {Object.entries(NUMBER_STATUS_LABELS).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <div className={listInspectorStyles.formStack}>
        <p className={surfaceControlsStyles.help}>Shown on</p>
        {pageLinks.length ? (
          <div className={workspaceFormsStyles.actions}>
            {pageLinks.map(page => (
              <TextLink key={page.id} href={'/pages/' + page.id} className={ownedStyles.linkChip} title={page.title}>
                {page.title}
              </TextLink>
            ))}
          </div>
        ) : (
          <p className="hint">No pages use this number yet.</p>
        )}
      </div>
      <Note>
        {pageLinks.length
          ? 'Save to keep the change private. Publish to update the live pages that use this number.'
          : 'Save to keep this number private. Publishing it by itself won’t change a public page.'}
      </Note>
    </div>
  )
}
