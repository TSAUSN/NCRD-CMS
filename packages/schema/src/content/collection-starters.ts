import type { CollectionModel } from './collections.ts'

/** Shared by the site wizard and collection creator. Existing schemas stay pinned. */
export const RESOURCE_COLLECTION_MODEL: CollectionModel = {
  fields: [
    { key: 'title', type: 'text', label: 'Resource title', required: true },
    { key: 'category', type: 'text', label: 'Category', required: false },
    { key: 'summary', type: 'richtext', label: 'Summary', required: false },
    { key: 'thumbnail', type: 'image', label: 'Thumbnail', required: false },
    {
      key: 'resource_url',
      type: 'url',
      label: 'Open resource',
      required: true,
      help: 'Choose a PDF, paste an https address, or use an internal path. This field label is also the visible link text.',
    },
  ],
  presentation: {
    schemaVersion: 1,
    titleField: 'title',
    subtitleField: 'category',
    imageField: 'thumbnail',
    groupField: 'category',
  },
}

export const PROGRAM_COLLECTION_MODEL: CollectionModel = {
  fields: [
    { key: 'title', type: 'text', label: 'Session title', required: true },
    { key: 'date', type: 'date', label: 'Date', required: true },
    {
      key: 'time',
      type: 'text',
      label: 'Time',
      required: true,
      help: 'Include the time zone, for example 10:30–11:15 AM ET. Sessions appear in the order you arrange below.',
    },
    { key: 'location', type: 'text', label: 'Location', required: false },
    { key: 'speakers', type: 'text', label: 'Speaker names', required: false },
    { key: 'category', type: 'text', label: 'Track or category', required: false },
    { key: 'summary', type: 'richtext', label: 'Session details', required: false },
    {
      key: 'session_url',
      type: 'url',
      label: 'Session information',
      required: false,
      help: 'Optional registration, meeting, or supporting-document link.',
    },
  ],
  presentation: { schemaVersion: 1, titleField: 'title', subtitleField: 'time', imageField: null, groupField: 'date' },
}

/**
 * A collection that began from an earlier resource or program starter, and the
 * fields of the current starter it does not have (COLL-05). Recognised by the
 * starter's own stable keys, never by the collection's name. Nothing is
 * applied here: the schema designer offers the fields for review, and they are
 * added optional so every existing record stays valid and starts them empty —
 * no original content is invented, and nothing changes publicly until the
 * schema and records are published.
 */
export type StarterUpgrade = { starter: 'resource' | 'program'; name: string; missing: CollectionModel['fields'] }

const STARTERS = [
  {
    starter: 'resource' as const,
    name: 'Resource',
    model: RESOURCE_COLLECTION_MODEL,
    identity: ['title', 'resource_url'],
  },
  { starter: 'program' as const, name: 'Program', model: PROGRAM_COLLECTION_MODEL, identity: ['title', 'date'] },
]

export function starterUpgrade(model: Pick<CollectionModel, 'fields'>): StarterUpgrade | null {
  const keys = new Set(model.fields.map(field => field.key))
  for (const candidate of STARTERS) {
    if (!candidate.identity.every(key => keys.has(key))) continue
    const missing = candidate.model.fields
      .filter(field => !keys.has(field.key))
      .map(field => ({ ...structuredClone(field), required: false }))
    return missing.length ? { starter: candidate.starter, name: candidate.name, missing } : null
  }
  return null
}

/** The model with the current starter's missing fields added after its own, optional; a free image slot shows the new picture. */
export function applyStarterUpgrade<T extends CollectionModel>(model: T): T {
  const upgrade = starterUpgrade(model)
  if (!upgrade) return model
  const image = upgrade.missing.find(field => field.type === 'image')
  return {
    ...model,
    fields: [...model.fields, ...upgrade.missing],
    presentation: {
      ...model.presentation,
      ...(model.presentation.imageField === null && image ? { imageField: image.key } : {}),
    },
  }
}
