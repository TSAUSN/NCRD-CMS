// Which section definitions the importer made, decided the same way on the
// server and in the editor (this module has no server-only imports).
const IMPORTED_SLOT = /^v1-[0-9a-f]{24}$/

/** Made by the importer: legacy markup whose every field carries an importer identity. */
export function isImportedDefinition(def: {
  slug: string
  definition_kind?: string | null
  slots: readonly { id: string }[]
}): boolean {
  return (
    (def.definition_kind ?? 'legacy') === 'legacy' &&
    def.slug.startsWith('v1-') &&
    def.slots.length > 0 &&
    def.slots.every(slot => IMPORTED_SLOT.test(slot.id))
  )
}
