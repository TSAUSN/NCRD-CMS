import { useEffect, useState } from 'react'
import {
  CollectionModel,
  starterUpgrade,
  type CollectionField,
  type CollectionFieldType,
  type CollectionModel as CollectionModelValue,
} from '@cms/schema'
import { useNavigationGuard, requestClientNavigation } from '../../../../components/navigation-guard.ts'
import type { ActionResult } from '../../../../lib/action-result.ts'
import { collectionDraftEqual } from './collection-workspace-model.ts'
import { clone } from './collection-entries.ts'

export function useCollectionSchemaDraft({
  initial,
  pending,
  onClose,
  onSave,
}: {
  initial: CollectionModelValue
  pending: boolean
  onClose: () => void
  onSave: (model: CollectionModelValue) => Promise<ActionResult | undefined> | undefined
}) {
  const [draft, setDraft] = useState(() => clone(initial))
  const parsed = CollectionModel.safeParse(draft)
  const issue = parsed.success ? undefined : parsed.error.issues[0]
  const fieldNumber = issue?.path[0] === 'fields' && typeof issue.path[1] === 'number' ? issue.path[1] + 1 : null
  const validationMessage =
    fieldNumber !== null
      ? issue?.path[2] === 'label'
        ? `Enter a label for field ${fieldNumber}.`
        : `Check the settings for field ${fieldNumber}, including its Advanced choices.`
      : 'Check the list fields and item-card choices before saving.'
  const dirty = !collectionDraftEqual(draft, initial)
  const saveBeforeLeaving = async () => {
    if (!parsed.success) return { ok: false, message: validationMessage }
    const result = await onSave(parsed.data)
    return result?.ok
      ? { ok: true }
      : {
          ok: false,
          message:
            result?.message ??
            'The fields could not be saved. Wait for the current action or check the saved list before trying again.',
        }
  }
  useNavigationGuard(() => ({
    dirty,
    pending,
    draft: { label: 'List fields', saveDraft: saveBeforeLeaving, discard: () => setDraft(clone(initial)) },
  }))
  useEffect(() => {
    if (typeof window === 'undefined') return
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  const dismiss = () => {
    const leave = () => {
      setDraft(clone(initial))
      onClose()
    }
    if (requestClientNavigation(leave)) leave()
  }
  const upgrade = starterUpgrade(draft)
  function updateField(index: number, change: Partial<CollectionField> & { type?: CollectionFieldType }) {
    setDraft(current => {
      const fields = [...current.fields]
      const before = fields[index]!
      const type = change.type ?? before.type
      const base = {
        key: before.key,
        label: before.label,
        required: before.required,
        ...(before.help ? { help: before.help } : {}),
        ...change,
        type,
      }
      fields[index] =
        type === 'select'
          ? ({
              ...base,
              type: 'select',
              options:
                'options' in change && Array.isArray(change.options)
                  ? change.options
                  : before.type === 'select'
                    ? before.options
                    : ['Option one', 'Option two'],
            } as CollectionField)
          : (Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'options')) as CollectionField)
      return { ...current, fields }
    })
  }
  function removeField(index: number) {
    setDraft(current => {
      const removed = current.fields[index]!.key
      const fields = current.fields.filter((_, fieldIndex) => fieldIndex !== index)
      const fallback = fields[0]?.key ?? ''
      return {
        fields,
        presentation: {
          ...current.presentation,
          titleField: current.presentation.titleField === removed ? fallback : current.presentation.titleField,
          subtitleField: current.presentation.subtitleField === removed ? null : current.presentation.subtitleField,
          imageField: current.presentation.imageField === removed ? null : current.presentation.imageField,
          groupField: current.presentation.groupField === removed ? null : current.presentation.groupField,
        },
      }
    })
  }
  function move(index: number, direction: -1 | 1) {
    const destination = index + direction
    if (destination < 0 || destination >= draft.fields.length) return
    setDraft(current => {
      const fields = [...current.fields]
      ;[fields[index], fields[destination]] = [fields[destination]!, fields[index]!]
      return { ...current, fields }
    })
  }
  function addField() {
    const used = new Set(draft.fields.map(field => field.key))
    let index = draft.fields.length + 1
    let key = `field_${index}`
    while (used.has(key)) {
      index += 1
      key = `field_${index}`
    }
    setDraft(current => ({
      ...current,
      fields: [...current.fields, { key, label: 'New field', type: 'text', required: false }],
    }))
  }
  const selectOptions = (allowed?: CollectionFieldType[]) =>
    draft.fields.filter(field => !allowed || allowed.includes(field.type))
  return {
    draft,
    setDraft,
    parsed,
    validationMessage,
    dirty,
    dismiss,
    upgrade,
    updateField,
    removeField,
    move,
    addField,
    selectOptions,
  }
}
