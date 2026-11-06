import { collectionTemplateSpec, type FieldLike } from './repeat-items.ts'
import type { StructuredRepeatFieldNode } from './structured.ts'

/** A field/type projection for the existing list resolver and list picker.
 * This is never a document to render: the original sanitized AST owns markup. */
export function collectionTemplateNode(
  slot: Pick<FieldLike, 'id' | 'kind' | 'constraints'>,
): StructuredRepeatFieldNode | null {
  const spec = collectionTemplateSpec(slot)
  if (!spec) return null
  return {
    type: 'repeat',
    field: slot.id,
    item: spec.fields.map(field => ({ type: field.kind as 'text' | 'richtext' | 'image' | 'link', field: field.id })),
    empty: { behavior: 'hide' },
  }
}
