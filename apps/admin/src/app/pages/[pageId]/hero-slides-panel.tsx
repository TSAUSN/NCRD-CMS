'use client'
import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import {
  moveRepeatItem,
  removeRepeatItem,
  repeatItemKeys,
  repeatItemSlotId,
  SAMPLE_FIELDS_KEY,
  sampleFieldNames,
  type FieldLike,
  type RepeatItemSpec,
} from '@cms/schema'
import { useReorderableList } from '../../../components/ui/use-reorderable-list.ts'
import { flatReorderIntent } from '../../../components/ui/flat-reorder.ts'
import { addEditorRepeatItem } from '../../../lib/editor-repeat-item.ts'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { storyPhotoInput } from '../../../lib/story-photo-input.ts'
import type { MediaAsset } from '../../../lib/media-library.ts'
import type { LinkTarget } from '../../../lib/queries.ts'
import { HeroStoryChooser, HeroSlideEditor, HeroSlidesList } from './hero-slide-panel-views.tsx'
type Choice = { id: string; title: string; description: string; photo: unknown; photoIsSample: boolean; url: string }

type HeroSlidesProps = {
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
}

export type HeroSlidesModel = ReturnType<typeof useHeroSlides>

export function HeroSlidesPanel(props: HeroSlidesProps) {
  const model = useHeroSlides(props)
  if (model.choosing) return <HeroStoryChooser model={model} />
  if (model.active && model.keys.includes(model.active)) return <HeroSlideEditor model={model} active={model.active} />
  return <HeroSlidesList model={model} />
}

function useHeroSlides(props: HeroSlidesProps) {
  const {
    slot,
    spec,
    values,
    selected,
    onValuesChange,
    siteId,
    media,
    canChooseStories,
    targets = [],
    canStyle = false,
  } = props
  const [active, setActive] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [choices, setChoices] = useState<Choice[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [dates, setDates] = useState<Set<string>>(() => new Set())
  const [copying, setCopying] = useState<string | null>(null)
  const boundary = useRef<HTMLDivElement>(null)
  const assetPreviews = useMemo(() => new Map(media.map(asset => [asset.id, asset.previewUrl])), [media])
  const photoThumbnail = (value: unknown) => {
    if (!value || typeof value !== 'object') return null
    const photo = value as { media_id?: string; src?: string }
    const id = photo.media_id ?? storyPhotoInput(value)?.id
    return (id ? assetPreviews.get(id) : null) ?? (photo.src?.startsWith('/cms-samples/') ? photo.src : null)
  }
  const keys = repeatItemKeys(values[slot.id], spec.max)
  const field = (key: string, id: string) => repeatItemSlotId(slot.id, key, id)
  const first = (key: string) => field(key, 'photo')
  const title = (key: string) => String(values[field(key, 'title')] ?? '').trim() || 'Untitled slide'
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

  function finishEditing() {
    setNewKey(null)
    setActive(null)
  }

  function editSlide(key: string) {
    setActive(key)
    onValuesChange(values, field(key, 'title'))
  }

  function duplicateSlide(key: string) {
    const added = addEditorRepeatItem(values, slot, { from: key, after: key })
    if (added.key) onValuesChange(added.values, null)
  }

  function startSlide() {
    setSearch('')
    if (canChooseStories) setChoosing(true)
    else add()
  }

  function schedule(key: string, enabled: boolean) {
    setDates(current => {
      const next = new Set(current)
      if (enabled) next.add(key)
      else next.delete(key)
      return next
    })
    onValuesChange(
      {
        ...values,
        [field(key, 'scheduled')]: enabled ? 'on' : 'off',
        ...(!enabled ? { [field(key, 'starts_at')]: '', [field(key, 'ends_at')]: '' } : {}),
      },
      selected,
    )
  }

  return {
    ...props,
    targets,
    canStyle,
    boundary,
    active,
    choosing,
    search,
    setSearch,
    choices,
    loading,
    error,
    retryStorySearch: () => setRetry(value => value + 1),
    newKey,
    copying,
    setCopying,
    dates,
    keys,
    photoThumbnail,
    field,
    title,
    escape,
    back,
    add,
    moveByKeyboard,
    update,
    reorder,
    finishEditing,
    editSlide,
    duplicateSlide,
    startSlide,
    schedule,
  }
}
