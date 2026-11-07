'use client'
import { useReorderableList } from '../../../components/ui/use-reorderable-list.ts'
import { flatReorderIntent } from '../../../components/ui/flat-reorder.ts'
import { DropIndicator, ReorderAnnouncement } from '../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../components/ui/reorderable-list.module.css'
import { EditorPanelActions } from './editor-panel-navigation.tsx'
import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import {
  heroSlideDateProblem,
  heroSlideContentProblem,
  heroSlideParityProblem,
  moveRepeatItem,
  removeRepeatItem,
  repeatItemKeys,
  repeatItemSlotId,
  type FieldLike,
  type RepeatItemSpec,
  SAMPLE_FIELDS_KEY,
  sampleFieldNames,
} from '@cms/schema'
import { IconChevronLeft, IconArrowUp, IconArrowDown, IconMore } from '../../../components/icons.tsx'
import { Button, Field, EmptyState, Menu, Disclosure } from '../../../components/ui/index.ts'
import { addEditorRepeatItem } from '../../../lib/editor-repeat-item.ts'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import type { MediaAsset } from '../../../lib/media-library.ts'
import { HeroCopyDialog } from './hero-copy-dialog.tsx'
import { HeroSlideFields } from './hero-slide-fields.tsx'
import type { LinkTarget } from '../../../lib/queries.ts'
import { heroEasternInput, heroEasternValue } from '../../../lib/hero-eastern-time.ts'
import { storyPhotoInput } from '../../../lib/story-photo-input.ts'
import shared from '../../../components/workspace.module.css'
type Choice = { id: string; title: string; description: string; photo: unknown; photoIsSample: boolean; url: string }

export function HeroSlidesPanel({
  slot,
  spec,
  values,
  selected,
  onValuesChange,
  renderItem,
  siteId,
  media,
  canChooseStories,
  renderField,
  targets = [],
  canStyle = false,
  pageId,
  definitionId,
  definitionVersion,
  publishedValues,
}: {
  slot: FieldLike
  spec: RepeatItemSpec
  values: Record<string, unknown>
  selected: string | null
  onValuesChange: (values: Record<string, unknown>, selected: string | null) => void
  renderItem: (key: string) => ReactNode
  siteId: string
  media: MediaAsset[]
  canChooseStories: boolean
  renderField?: (key: string, id: string) => ReactNode
  targets?: LinkTarget[]
  canStyle?: boolean
  pageId?: string
  definitionId?: string
  definitionVersion?: number
  publishedValues?: Record<string, unknown>
}) {
  const [active, setActive] = useState<string | null>(null),
    [newKey, setNewKey] = useState<string | null>(null),
    [choosing, setChoosing] = useState(false),
    [choices, setChoices] = useState<Choice[]>([]),
    [search, setSearch] = useState(''),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [dates, setDates] = useState<Set<string>>(() => new Set()),
    [copying, setCopying] = useState<string | null>(null),
    boundary = useRef<HTMLDivElement>(null)
  const photoThumbnail = (value: unknown) => {
    if (!value || typeof value !== 'object') return null
    const photo = value as { media_id?: string; src?: string },
      id = photo.media_id ?? storyPhotoInput(value)?.id
    return (
      media.find(asset => asset.id === id)?.previewUrl ?? (photo.src?.startsWith('/cms-samples/') ? photo.src : null)
    )
  }
  const keys = repeatItemKeys(values[slot.id], spec.max),
    field = (key: string, id: string) => repeatItemSlotId(slot.id, key, id),
    first = (key: string) => field(key, 'photo'),
    title = (key: string) => String(values[field(key, 'title')] ?? '').trim() || 'Untitled slide'
  useEffect(() => {
    boundary.current?.closest<HTMLElement>('[role=tabpanel]')?.scrollTo({ top: 0, behavior: 'instant' })
  }, [active, choosing])
  useEffect(() => {
    if (selected) {
      const key = keys.find(key => selected.startsWith(slot.id + '__' + key + '__'))
      if (key) setActive(key)
    }
  }, [selected])
  useNavigationGuard(() => ({
    dirty: newKey !== null,
    pending: false,
    draft: {
      label: 'New slide',
      saved: true,
      discardLabel: 'Discard my edits',
      saveDraft: async () => {
        setNewKey(null)
        setActive(null)
        return { ok: true }
      },
      discard: () => {
        setNewKey(null)
        setActive(null)
      },
    },
  }))
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (newKey !== null) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [newKey])
  useEffect(() => {
    if (!choosing) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer = window.setTimeout(() => {
      void fetch('/api/sites/' + siteId + '/story-choices?q=' + encodeURIComponent(search), {
        signal: controller.signal,
      })
        .then(async response => {
          if (!response.ok) throw Error('unavailable')
          const data = await response.json()
          if (!Array.isArray(data.choices)) throw Error('unavailable')
          if (!controller.signal.aborted) setChoices(data.choices)
        })
        .catch(() => {
          if (!controller.signal.aborted) setError('Stories could not be loaded. Try again, or start empty.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 150)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [choosing, siteId, search, retry])
  function back() {
    if (newKey) {
      const next = removeRepeatItem(values, slot, newKey)
      onValuesChange(next, null)
    }
    setNewKey(null)
    setActive(null)
    setChoosing(false)
  }
  function escape(event: KeyboardEvent<HTMLDivElement>) {
    if (
      (active || choosing) &&
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      !(event.target as Element).closest('dialog')
    ) {
      event.preventDefault()
      event.stopPropagation()
      back()
    }
  }
  function add(choice?: Choice) {
    const added = addEditorRepeatItem(values, slot)
    if (!added.key) return
    let next = added.values
    if (choice) {
      next = {
        ...next,
        [field(added.key, 'title')]: choice.title,
        [field(added.key, 'intro')]: choice.description,
        [field(added.key, 'photo')]: choice.photo,
        [field(added.key, 'primary')]: { label: 'Read More', url: choice.url },
      }
      if (choice.photoIsSample) next[SAMPLE_FIELDS_KEY] = [...sampleFieldNames(next), field(added.key, 'photo')]
    }
    setNewKey(added.key)
    setActive(added.key)
    setChoosing(false)
    onValuesChange(next, first(added.key))
  }
  function move(from: number, to: number) {
    const key = keys[from]
    if (!key || from === to || to < 0 || to >= keys.length) return
    onValuesChange(moveRepeatItem(values, slot, key, to - from), selected)
    return `Moved ${title(key)} to position ${to + 1}.`
  }
  const reorder = useReorderableList({
    mimeType: 'application/x-cms-slide',
    decide: point => flatReorderIntent(keys, point),
    apply: ({ from, to }) => move(from, to),
  })
  function moveByKeyboard(from: number, to: number) {
    const message = move(from, to)
    if (message) reorder.announce(message)
  }
  function update(key: string, id: string, value: unknown) {
    onValuesChange({ ...values, [field(key, id)]: value }, selected)
  }
  if (choosing)
    return (
      <div ref={boundary} onKeyDownCapture={escape} className={shared.stack + ' ' + shared.compactForm}>
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
          <p className={shared.meta}>Start from a story, or fill it in yourself.</p>
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
            <Button variant="secondary" onClick={() => setRetry(value => value + 1)}>
              Try again
            </Button>
          </div>
        ) : !choices.length ? (
          <EmptyState title="No stories found">Try another search, or start empty.</EmptyState>
        ) : (
          <ul className={shared.compactItemList}>
            {choices.map(choice => (
              <li key={choice.id}>
                <Button
                  className={shared.itemButton}
                  title={choice.title}
                  variant="tertiary"
                  onClick={() => add(choice)}
                >
                  {photoThumbnail(choice.photo) && (
                    <img src={photoThumbnail(choice.photo)!} alt="" className={shared.itemThumb} />
                  )}
                  <span>{choice.title}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button onClick={() => add()}>Start empty</Button>
      </div>
    )
  if (active && keys.includes(active)) {
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
      <div ref={boundary} onKeyDownCapture={escape} className={shared.stack + ' ' + shared.compactForm}>
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
          <Button
            disabled={!!contentProblem}
            onClick={() => {
              setNewKey(null)
              setActive(null)
            }}
          >
            Done
          </Button>
        </EditorPanelActions>
        <div>
          <h3>{newKey ? 'New slide' : `Slide ${keys.indexOf(active) + 1} of ${keys.length}`}</h3>
          <p className={shared.meta}>{contentProblem ?? 'The page changes as you type. Cancel removes a new slide.'}</p>
        </div>
        <label className={shared.toggleRow}>
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
        <label className={shared.toggleRow}>
          <span>Schedule this slide</span>
          <input
            type="checkbox"
            checked={hasDates}
            onChange={event => {
              setDates(current => {
                const next = new Set(current)
                if (event.target.checked) next.add(active)
                else next.delete(active)
                return next
              })
              onValuesChange(
                {
                  ...values,
                  [field(active, 'scheduled')]: event.target.checked ? 'on' : 'off',
                  ...(!event.target.checked
                    ? { [field(active, 'starts_at')]: '', [field(active, 'ends_at')]: '' }
                    : {}),
                },
                selected,
              )
            }}
          />
        </label>
        {!hasDates && <p className={shared.meta}>Off: it shows whenever its switch is on and the page is published.</p>}
        {hasDates && (
          <>
            <p className={shared.meta}>
              Eastern time. The end minute is included. Other slides keep showing afterward. The repeated autumn hour
              uses its first occurrence.
            </p>
            <div className={shared.formStack}>
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
  return (
    <div ref={boundary} onKeyDownCapture={escape} className={shared.listGroup + ' ' + shared.compactForm}>
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
        <p className={shared.meta}>Drag to reorder. Choose a slide to edit its words, photo and buttons.</p>
      </div>
      {!keys.length ? (
        <EmptyState title="No slides yet">Add a slide to put a feature on the page.</EmptyState>
      ) : (
        <ol className={shared.compactItemList + ' ' + reorderStyles.list} data-reorder-list>
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
                  className={shared.itemButton}
                  title={title(key)}
                  variant="tertiary"
                  onClick={() => {
                    setActive(key)
                    onValuesChange(values, field(key, 'title'))
                  }}
                >
                  {thumbnail && <img src={thumbnail} alt="" className={shared.itemThumb} />}
                  <span>
                    {at + 1}. {title(key)}
                  </span>
                </Button>
                <label className={shared.toggleRow} data-layout="inline">
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
                  <Button
                    variant="tertiary"
                    onClick={() => {
                      setActive(key)
                      onValuesChange(values, field(key, 'title'))
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="tertiary"
                    disabled={keys.length >= spec.max}
                    onClick={() => {
                      const added = addEditorRepeatItem(values, slot, { from: key, after: key })
                      if (added.key) onValuesChange(added.values, null)
                    }}
                  >
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
      <Button
        fullWidth
        variant="secondary"
        disabled={keys.length >= spec.max}
        onClick={() => {
          setSearch('')
          if (canChooseStories) setChoosing(true)
          else add()
        }}
      >
        Add slide
      </Button>
      {slot.constraints?.heroEditingParity === true && canStyle && (
        <>
          <label className={shared.toggleRow}>
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
        <p className={shared.meta}>
          The next chevron and dots work here and on the live page. On the live page, slides change at the chosen
          interval (6 seconds by default) and pause on hover or focus. Editing stays on the slide you choose.
        </p>
      </Disclosure>
    </div>
  )
}
