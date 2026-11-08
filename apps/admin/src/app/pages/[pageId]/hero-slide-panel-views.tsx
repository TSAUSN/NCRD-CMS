import { DropIndicator, ReorderAnnouncement } from '../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../components/ui/reorderable-list.module.css'
import { EditorPanelActions } from './editor-panel-navigation.tsx'
import { heroSlideDateProblem, heroSlideContentProblem, heroSlideParityProblem, removeRepeatItem } from '@cms/schema'
import { IconChevronLeft, IconArrowUp, IconArrowDown, IconMore } from '../../../components/icons.tsx'
import { Button, Field, EmptyState, Menu, Disclosure } from '../../../components/ui/index.ts'
import { HeroCopyDialog } from './hero-copy-dialog.tsx'
import { HeroSlideFields } from './hero-slide-fields.tsx'
import { heroEasternInput, heroEasternValue } from '../../../lib/hero-eastern-time.ts'
import type { HeroSlidesModel } from './hero-slides-panel.tsx'
import shared from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../components/workspace-styles/list-inspector.module.css'
import ownedStyles from './hero-slides-panel-styles.module.css'

export function HeroStoryChooser({ model }: { model: HeroSlidesModel }) {
  const { boundary, escape, back, search, setSearch, loading, error, retryStorySearch, choices, add, photoThumbnail } =
    model
  return (
    <div ref={boundary} onKeyDownCapture={escape} className={shared.stack + ' ' + workspaceFormsStyles.compactForm}>
      <EditorPanelActions>
        <Button variant="tertiary" title="Back to all slides" onClick={back}>
          <IconChevronLeft size={16} />
          Back
        </Button>
        <Button variant="secondary" onClick={back}>
          Done
        </Button>
      </EditorPanelActions>
      <div>
        <h3>New slide</h3>
        <p className={recordTableStyles.meta}>Start from a story, or fill it in yourself.</p>
      </div>
      <Field id="hero-find-story" label="Find a story">
        <input
          type="search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Title or description"
        />
      </Field>
      {loading ? (
        <p role="status">Loading stories…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={retryStorySearch}>
            Try again
          </Button>
        </div>
      ) : !choices.length ? (
        <EmptyState title="No stories found">Try another search, or start empty.</EmptyState>
      ) : (
        <ul className={listInspectorStyles.compactItemList}>
          {choices.map(choice => {
            const thumbnail = photoThumbnail(choice.photo)
            return (
              <li key={choice.id}>
                <Button
                  className={listInspectorStyles.itemButton}
                  title={choice.title}
                  variant="tertiary"
                  onClick={() => add(choice)}
                >
                  {thumbnail && <img src={thumbnail} alt="" className={ownedStyles.itemThumb} />}
                  <span>{choice.title}</span>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <Button onClick={() => add()}>Start empty</Button>
    </div>
  )
}

export function HeroSlideEditor({ model, active }: { model: HeroSlidesModel; active: string }) {
  const {
    boundary,
    escape,
    back,
    newKey,
    finishEditing,
    keys,
    values,
    field,
    update,
    slot,
    renderField,
    selected,
    targets,
    canStyle,
    publishedValues,
    photoThumbnail,
    renderItem,
    dates,
    schedule,
  } = model
  const dateProblem = heroSlideDateProblem(values, slot.id, active),
    hasDates =
      dates.has(active) ||
      values[field(active, 'scheduled')] === 'on' ||
      Boolean(values[field(active, 'starts_at')] || values[field(active, 'ends_at')]),
    contentProblem =
      heroSlideContentProblem(values, slot.id, active) ||
      (slot.constraints?.heroEditingParity === true
        ? heroSlideParityProblem(values, slot.id, active, publishedValues?.[field(active, 'intro')])
        : null)
  return (
    <div ref={boundary} onKeyDownCapture={escape} className={shared.stack + ' ' + workspaceFormsStyles.compactForm}>
      <EditorPanelActions>
        <Button variant="tertiary" title="Back to all slides" onClick={back}>
          <IconChevronLeft size={16} />
          Back
        </Button>
        {newKey && (
          <Button variant="secondary" onClick={back}>
            Cancel
          </Button>
        )}
        <Button disabled={!!contentProblem} onClick={finishEditing}>
          Done
        </Button>
      </EditorPanelActions>
      <div>
        <h3>{newKey ? 'New slide' : `Slide ${keys.indexOf(active) + 1} of ${keys.length}`}</h3>
        <p className={recordTableStyles.meta}>
          {contentProblem ?? 'The page changes as you type. Cancel removes a new slide.'}
        </p>
      </div>
      <label className={selectionControlsStyles.toggleRow}>
        <span>Show this slide</span>
        <input
          type="checkbox"
          checked={values[field(active, 'enabled')] !== 'off'}
          onChange={event => update(active, 'enabled', event.target.checked ? 'on' : 'off')}
        />
      </label>
      {slot.constraints?.heroEditingParity === true && renderField ? (
        <HeroSlideFields
          key={active}
          selectedField={selected}
          repeat={slot.id}
          item={active}
          values={values}
          onChange={(id, value) => update(active, id, value)}
          renderField={id => renderField(active, id)}
          targets={targets}
          canStyle={canStyle}
          publishedIntro={publishedValues?.[field(active, 'intro')]}
          photoUrl={photoThumbnail(values[field(active, 'photo')])}
          phonePhotoUrl={photoThumbnail(values[field(active, 'phone_photo')])}
        />
      ) : (
        renderItem(active)
      )}
      <label className={selectionControlsStyles.toggleRow}>
        <span>Schedule this slide</span>
        <input type="checkbox" checked={hasDates} onChange={event => schedule(active, event.target.checked)} />
      </label>
      {!hasDates && (
        <p className={recordTableStyles.meta}>Off: it shows whenever its switch is on and the page is published.</p>
      )}
      {hasDates && (
        <>
          <p className={recordTableStyles.meta}>
            Eastern time. The end minute is included. Other slides keep showing afterward. The repeated autumn hour uses
            its first occurrence.
          </p>
          <div className={listInspectorStyles.formStack}>
            {[
              ['starts_at', 'Show from'],
              ['ends_at', 'Show until'],
            ].map(([id, label]) => (
              <Field key={id} id={'hero-' + id} label={label}>
                <input
                  type="datetime-local"
                  value={heroEasternInput(values[field(active, id!)], id === 'ends_at')}
                  onChange={event => update(active, id!, heroEasternValue(event.target.value, id === 'ends_at'))}
                />
              </Field>
            ))}
          </div>
          {dateProblem && <p role="alert">{dateProblem}</p>}
        </>
      )}
    </div>
  )
}

export function HeroSlidesList({ model }: { model: HeroSlidesModel }) {
  const {
    boundary,
    escape,
    copying,
    setCopying,
    pageId,
    definitionId,
    definitionVersion,
    slot,
    values,
    keys,
    photoThumbnail,
    field,
    reorder,
    title,
    editSlide,
    update,
    moveByKeyboard,
    spec,
    duplicateSlide,
    onValuesChange,
    selected,
    startSlide,
    canStyle,
  } = model
  return (
    <div
      ref={boundary}
      onKeyDownCapture={escape}
      className={listInspectorStyles.listGroup + ' ' + workspaceFormsStyles.compactForm}
    >
      {copying && pageId && definitionId && definitionVersion && (
        <HeroCopyDialog
          sourcePageId={pageId}
          definitionId={definitionId}
          version={definitionVersion}
          slotId={slot.id}
          item={copying}
          values={values}
          onClose={() => setCopying(null)}
        />
      )}
      <div>
        <h3>Hero slides</h3>
        <p className={recordTableStyles.meta}>Drag to reorder. Choose a slide to edit its words, photo and buttons.</p>
      </div>
      {!keys.length ? (
        <EmptyState title="No slides yet">Add a slide to put a feature on the page.</EmptyState>
      ) : (
        <ol className={listInspectorStyles.compactItemList + ' ' + reorderStyles.list} data-reorder-list>
          {keys.map((key, at) => {
            const thumbnail = photoThumbnail(values[field(key, 'photo')])
            return (
              <li key={key} {...reorder.row(key)}>
                <DropIndicator marker={reorder.marker} row={key} />
                {(reorder.blocked ?? reorder.rejection)?.row === key && (
                  <span aria-hidden="true" className={reorderStyles.reason}>
                    {(reorder.blocked ?? reorder.rejection)?.message}
                  </span>
                )}
                <Button
                  className={listInspectorStyles.itemButton}
                  title={title(key)}
                  variant="tertiary"
                  onClick={() => editSlide(key)}
                >
                  {thumbnail && <img src={thumbnail} alt="" className={ownedStyles.itemThumb} />}
                  <span>
                    {at + 1}. {title(key)}
                  </span>
                </Button>
                <label className={selectionControlsStyles.toggleRow} data-layout="inline">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={'Show slide ' + (at + 1)}
                    checked={values[field(key, 'enabled')] !== 'off'}
                    onChange={event => update(key, 'enabled', event.target.checked ? 'on' : 'off')}
                  />{' '}
                  {values[field(key, 'enabled')] !== 'off' ? 'On' : 'Off'}
                </label>
                <Menu label={<IconMore size={16} />} accessibleLabel={'Slide ' + (at + 1) + ' actions'}>
                  <Button
                    variant="secondary"
                    size="s"
                    disabled={at === 0}
                    aria-label={'Move slide ' + (at + 1) + ' up'}
                    onClick={() => moveByKeyboard(at, at - 1)}
                  >
                    <IconArrowUp size={16} />
                  </Button>
                  <Button
                    variant="secondary"
                    size="s"
                    disabled={at === keys.length - 1}
                    aria-label={'Move slide ' + (at + 1) + ' down'}
                    onClick={() => moveByKeyboard(at, at + 1)}
                  >
                    <IconArrowDown size={16} />
                  </Button>
                  <Button variant="tertiary" onClick={() => editSlide(key)}>
                    Edit
                  </Button>
                  <Button variant="tertiary" disabled={keys.length >= spec.max} onClick={() => duplicateSlide(key)}>
                    Duplicate
                  </Button>
                  {slot.constraints?.heroEditingParity === true && pageId && definitionId && definitionVersion && (
                    <Button variant="tertiary" onClick={() => setCopying(key)}>
                      Copy to another page
                    </Button>
                  )}
                  <Button
                    variant="tertiary"
                    size="s"
                    aria-label={'Remove slide ' + (at + 1)}
                    onClick={() => onValuesChange(removeRepeatItem(values, slot, key), null)}
                  >
                    Delete
                  </Button>
                </Menu>
              </li>
            )
          })}
        </ol>
      )}
      <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
      <Button fullWidth variant="secondary" disabled={keys.length >= spec.max} onClick={startSlide}>
        Add slide
      </Button>
      {slot.constraints?.heroEditingParity === true && canStyle && (
        <>
          <label className={selectionControlsStyles.toggleRow}>
            <span>Change slides automatically</span>
            <input
              type="checkbox"
              checked={values.auto_change !== 'off'}
              onChange={event =>
                onValuesChange({ ...values, auto_change: event.target.checked ? 'on' : 'off' }, selected)
              }
            />
          </label>
          {values.auto_change !== 'off' && (
            <Field id="hero-seconds" label="Seconds per slide">
              <input
                type="number"
                min={2}
                max={30}
                step={1}
                value={String(values.seconds ?? '6')}
                onChange={event => onValuesChange({ ...values, seconds: event.target.value }, selected)}
              />
            </Field>
          )}
        </>
      )}
      <Disclosure title="How the slider works">
        <p className={recordTableStyles.meta}>
          The next chevron and dots work here and on the live page. On the live page, slides change at the chosen
          interval (6 seconds by default) and pause on hover or focus. Editing stays on the slide you choose.
        </p>
      </Disclosure>
    </div>
  )
}
