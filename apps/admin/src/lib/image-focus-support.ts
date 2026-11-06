/** Attribute-bound pictures retain definition-owned markup. Only a renderer-
 * owned image element can carry a per-page focus without rewriting that HTML. */
export function supportsImageFocus(kind: string, ast: unknown): boolean {
  if (kind === 'structured') return true
  if (kind !== 'legacy' || !ast || typeof ast !== 'object' || !('nodes' in ast) || !Array.isArray(ast.nodes))
    return false
  const images = ast.nodes.filter(
    node => node && typeof node === 'object' && node.kind === 'slot' && node.slotKind === 'image',
  )
  return images.length > 0 && images.every(node => node.context === 'element-text')
}
