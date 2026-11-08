import { Card, Field } from '../../../../../components/ui/index.ts'
import frame from '../../../../../components/content-editor.module.css'
import { RichTextField } from '../../../../pages/[pageId]/rich-text-field.tsx'
import selectionControlsStyles from '../../../../../components/workspace-styles/selection-controls.module.css'
import type { StoryDraftModel } from './use-story-draft.ts'

export function StoryContentFields({ model }: { model: StoryDraftModel }) {
  const { entry, value, disabled, change, summaryLength } = model
  return (
    <>
      <Card density="editor">
        <div className={frame.fields}>
          <Field id="story-title" label="Title">
            <input
              value={value.title}
              maxLength={180}
              onChange={event => change('title', event.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field
            id="story-summary"
            label={
              <>
                Summary <span className={frame.help}>(used on cards and in search, up to 155 characters)</span>
              </>
            }
            counter={value.summary.length + ' / 155'}
            help={
              summaryLength > 155 ? (
                <span className={frame.help}>
                  The existing summary has {summaryLength} characters. Keep it unchanged, or shorten it to 155 when
                  editing.
                </span>
              ) : undefined
            }
          >
            <textarea
              aria-label="Summary"
              value={value.summary}
              maxLength={Math.max(155, summaryLength)}
              rows={3}
              onChange={event => change('summary', event.target.value)}
              disabled={disabled}
            />
          </Field>
        </div>
      </Card>
      <Card title={<span id="story-text-label">Story text</span>} density="editor" className={frame.text}>
        <RichTextField
          id="story-body"
          labelId="story-text-label"
          value={value.body}
          onChange={next => change('body', next)}
          disabled={disabled}
          sourceMode={false}
        />
        {(value.body_is_sample || entry.values.body_is_sample === true) && (
          <label className={selectionControlsStyles.checkRow}>
            <input
              type="checkbox"
              checked={value.body_is_sample}
              onChange={event => change('body_is_sample', event.target.checked)}
              disabled={disabled}
            />
            This body is sample content
          </label>
        )}
      </Card>
    </>
  )
}
