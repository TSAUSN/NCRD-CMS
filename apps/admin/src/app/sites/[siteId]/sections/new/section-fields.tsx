import { SlotIcon } from '../../../../../components/icons.tsx'
import { SourceSampleEditor } from '../../../../../components/source-sample-editor.tsx'
import type { HtmlSectionDraft } from './use-html-section-draft.ts'

/** The kinds an author can choose, in the words the inspector will use. */
const KINDS = [
  { id: 'text', label: 'Short text' },
  { id: 'richtext', label: 'Formatted text' },
  { id: 'image', label: 'Image' },
  { id: 'link', label: 'Link' },
  { id: 'button', label: 'Button' },
  { id: 'navigation', label: 'Site menu' },
] as const

export function SectionFields({ model }: { model: HtmlSectionDraft }) {
  const { placement, setLabels, setKinds, constraints, setConstraints, busy, slots } = model
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Fields</h2>
          {slots.length > 0 && <span className="muted">{slots.length} derived from the markup</span>}
        </div>
        {slots.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No fields yet. Add <code className="mono">{'{{a-name}}'}</code> to the markup above and it will appear here.
            A section with no fields is allowed — it is just the same on every page that uses it.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="slot-table">
              <thead>
                <tr>
                  <th>In the markup</th>
                  <th>Editors will see</th>
                  <th>Holds</th>
                </tr>
              </thead>
              <tbody>
                {slots.map(slot => (
                  <tr key={slot.id}>
                    <td>
                      <code className="mono">{`{{${slot.id}}}`}</code>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`label-${slot.id}`}>
                        Label for {slot.id}
                      </label>
                      <input
                        id={`label-${slot.id}`}
                        type="text"
                        value={slot.label}
                        disabled={busy}
                        onChange={event => setLabels(current => ({ ...current, [slot.id]: event.target.value }))}
                      />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`kind-${slot.id}`}>
                        What {slot.id} holds
                      </label>
                      <span className="kind-cell">
                        <SlotIcon kind={slot.kind} size={15} />
                        <select
                          id={`kind-${slot.id}`}
                          value={slot.kind}
                          disabled={busy}
                          onChange={event => setKinds(current => ({ ...current, [slot.id]: event.target.value }))}
                        >
                          {KINDS.filter(
                            kind => kind.id !== 'navigation' || placement !== 'page' || slot.kind === 'navigation',
                          ).map(kind => (
                            <option key={kind.id} value={kind.id}>
                              {kind.label}
                            </option>
                          ))}
                        </select>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {slots.some(slot => constraints[slot.id]?.sourceSample !== undefined) && (
        <section className="card">
          <h2>Starting content</h2>
          <p>
            These examples are copied into new sections. Existing pages keep their own content. Review image permissions
            and links before using this section in another site.
          </p>
          {slots
            .filter(slot => constraints[slot.id]?.sourceSample !== undefined)
            .map(slot => (
              <SourceSampleEditor
                key={slot.id}
                id={slot.id}
                label={slot.label}
                kind={slot.kind}
                value={constraints[slot.id]?.sourceSample}
                disabled={busy}
                onChange={value =>
                  setConstraints(current => ({
                    ...current,
                    [slot.id]: { ...current[slot.id], sourceSample: value },
                  }))
                }
              />
            ))}
        </section>
      )}
    </>
  )
}
