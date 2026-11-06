import type { CollectionModel } from '@cms/schema'
/** Task words shared by the list workspace, inspector and canvas controls. */
export function listItemUnit(readerKey: string): string {
  return (
    (
      {
        speakers: 'speaker',
        program: 'session',
        workshops: 'workshop',
        people: 'person',
        resources: 'resource',
        sponsors: 'sponsor',
      } as Record<string, string>
    )[readerKey] ?? 'item'
  )
}

/** Source history may contain a blank title. New items still need a useful
 * name; editing an original blank row does not silently invent content. */
export function listItemFields(model: CollectionModel, editing: boolean) {
  return model.fields.map(field =>
    !editing && field.key === model.presentation.titleField ? { ...field, required: true } : field,
  )
}
