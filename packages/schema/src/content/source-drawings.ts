// The drawings V1's sections draw in their icon regions, as a code-owned set
// (generated; see packages/importer/src/source-drawings.ts). A field with this
// presentation stores a drawing's name, never SVG: the renderer draws the
// set's own markup, and anything else draws nothing (LIB-02).
import { SOURCE_DRAWINGS } from './source-drawings.generated.ts'

export { SOURCE_DRAWINGS }
export type SourceDrawingKey = keyof typeof SOURCE_DRAWINGS
export const SOURCE_DRAWING_PRESENTATION = 'v1-source-drawings'

export function isSourceDrawing(value: unknown): value is SourceDrawingKey {
  return typeof value === 'string' && Object.hasOwn(SOURCE_DRAWINGS, value)
}

export function isDrawingSlot(slot: { kind?: string; constraints?: Record<string, unknown> }): boolean {
  return slot.kind === 'text' && slot.constraints?.['presentation'] === SOURCE_DRAWING_PRESENTATION
}
