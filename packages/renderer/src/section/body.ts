import {
  renderCollectionTemplate,
  markCollectionTemplateParents,
  collectionTemplateMarker,
  type CollectionTemplateMark,
} from '../collection-template.ts'
import {
  isDrawingSlot,
  isIconSlot,
  MATERIAL_ICON_PRESENTATION,
  isSourceDrawing,
  repeatItemKeys,
  SOURCE_DRAWINGS,
  repeatItemSlotId,
  repeatItemSpec,
  collectionTemplateSpec,
  type SlotDef,
} from '@cms/schema'
import { upgradeCompiledSection, isTypedAttributeBinding, repeatRanges, type AstNode } from '../compile.ts'
import { renderCmsIcon, renderMaterialIcon } from '../icons.ts'
import { scanSlotSites } from '../context.ts'
import { escapeAttribute, escapeText } from '../escape.ts'
import { renderStructuredBody, sectionDefinitionKind } from '../structured.ts'
import { type SectionDefView, type RenderOptions } from '../types.ts'
import { renderSlot } from './slot-value.ts'

/**
 * The markup inside one section's wrapper, chosen by the definition's own
 * discriminator, or null when this renderer will not emit any.
 *
 * The dispatch is on what the row says it is, never on what it looks like. A
 * structured row carries an empty compiled AST and a legacy row carries no
 * structured document, so "whichever artifact is present" would work today and
 * would keep working right up until a partially-written row made it choose the
 * wrong one — and the wrong choice renders a section that is silently missing
 * its content rather than one that visibly fails.
 */
export function renderSectionBody(
  def: SectionDefView,
  values: Record<string, unknown>,
  options: RenderOptions,
): string | null {
  const kind = sectionDefinitionKind(def)
  if (kind === null) return null
  if (kind === 'structured')
    return renderStructuredBody(def, values, {
      ...options,
      ...(def.slots?.[0]?.constraints?.coreLibrary === 'r8' && def.slots[0].constraints?.coreList === 'program'
        ? { groupRepeatsBy: { program: 'date' }, filterRepeatsBy: { program: 'category' } }
        : {}),
    })

  // The renderer independently checks the AST it was handed. The authoring
  // command will not store a definition with blocking problems, but "the other
  // layer would have caught it" is not a property this layer can verify — and
  // the AST arrives from a database row that a migration, a restore, or a hand
  // edit could have produced. An AST below the current policy version is
  // re-classified from its own nodes rather than reinterpreted in place, and
  // one that cannot be classified safely renders nothing at all.
  const upgraded = upgradeCompiledSection(def.compiled_ast)
  if (upgraded.blocking.length > 0) return null

  const marks: CollectionTemplateMark[] = []
  const expanded = expandRepeats(
    upgraded.ast.nodes,
    def.slots ?? [],
    values,
    options.preview === true,
    marks,
    (nodes, slots, item) =>
      renderSectionBody({ ...def, compiled_ast: { ...upgraded.ast, nodes }, slots }, item, {
        ...options,
        preview: false,
      }),
  )
  const nodes = options.preview ? instrumentTypedAttributes(expanded.nodes) : expanded.nodes
  const hosts = options.preview ? richTextHosts(nodes) : new Map<number, string>()
  const html = nodes
    .map((node, index) => {
      if (node.kind === 'html') {
        const hosted = hosts.get(index + 1)
        return hosted === undefined
          ? node.value
          : node.value.replace(/(\s*\/?)>$/, ` data-cms-slot="${escapeAttribute(hosted)}" data-cms-kind="richtext"$1>`)
      }
      const slot = expanded.fields.get(node.slotId)
      const textHere = node.context === 'element-text' && node.slotKind === 'text' && slot !== undefined
      // A code-owned symbol or one of V1's own drawings, by name; never stored markup.
      const drawing = textHere && isDrawingSlot(slot)
      const icon = drawing || (textHere && isIconSlot(slot))
      const date =
        textHere && ['cms-date-long-v1', 'cms-date-calendar-v1'].includes(String(slot.constraints?.presentation))
      const value = values[node.slotId]
      const rendered = drawing
        ? isSourceDrawing(value)
          ? SOURCE_DRAWINGS[value].svg
          : ''
        : icon
          ? slot?.constraints?.presentation === MATERIAL_ICON_PRESENTATION
            ? renderMaterialIcon(value)
            : renderCmsIcon(value)
          : renderSlot(node, values, options, slot)
      // The editor needs a node it can select, outline, and type into. Public
      // output gets no wrapper at all, so the published markup stays exactly
      // what the section author wrote.
      //
      // A wrapper only makes sense between tags. Wrapping an attribute-position
      // slot emitted a literal `<span …>` inside a quoted value, which is not a
      // node the editor can select — it is a broken attribute, and in preview
      // only, which is the worst place for the two paths to diverge.
      if (!options.preview || node.context !== 'element-text' || hosts.has(index)) return rendered
      // A dedicated inert element avoids styling editor markup as authored
      // content (for example Echelon's `.hero h1 span` subtitle selector).
      return (
        `<cms-slot data-cms-slot="${escapeAttribute(node.slotId)}"` +
        ` data-cms-kind="${icon ? 'icon' : date ? 'date' : escapeAttribute(node.slotKind)}">${rendered}</cms-slot>`
      )
    })
    .join('')
  return markCollectionTemplateParents(html, marks)
}

/**
 * Draw each repeat's item markup once per item, in the item order the value
 * holds (LIB-02). An item field's node takes its composed id
 * (`cards__i2__title`), so the value it reads and the field the editor selects
 * are that item's own. The markers themselves render nothing. In a preview, a
 * list with no items says so where its items would be.
 */
function expandRepeats(
  nodes: readonly AstNode[],
  slots: readonly SlotDef[],
  values: Record<string, unknown>,
  preview: boolean,
  marks: CollectionTemplateMark[],
  renderItem: (nodes: AstNode[], slots: SlotDef[], values: Record<string, unknown>) => string | null,
): { nodes: AstNode[]; fields: Map<string, SlotDef> } {
  const fields = new Map<string, SlotDef>(slots.map(slot => [slot.id, slot]))
  const ranges = repeatRanges(nodes)
  if (ranges.size === 0) return { nodes: [...nodes], fields }
  const out: AstNode[] = []
  for (let at = 0; at < nodes.length; at += 1) {
    const node = nodes[at]!
    if (node.kind !== 'slot' || node.marker !== 'start') {
      out.push(node)
      continue
    }
    const end = ranges.get(node.slotId)?.[1] ?? at
    const body = nodes.slice(at + 1, end)
    at = end
    const owner = slots.find(slot => slot.id === node.slotId)
    const collectionSpec = owner ? collectionTemplateSpec(owner) : null
    if (collectionSpec) {
      const rendered = renderCollectionTemplate({
        raw: values[node.slotId],
        field: node.slotId,
        fields: collectionSpec.fields,
        preview,
        render: item => renderItem([...body], collectionSpec.fields, item),
      })
      if (rendered) {
        if (preview)
          marks.push({ field: node.slotId, readerKey: rendered.readerKey, collectionId: rendered.collectionId })
        out.push({ kind: 'html', value: (preview ? collectionTemplateMarker(node.slotId) : '') + rendered.html })
      }
      continue
    }
    const spec = owner ? repeatItemSpec(owner) : null
    if (!spec) continue
    const keys = repeatItemKeys(values[node.slotId], spec.max)
    const board = owner?.constraints?.boardCards === true
    const disclose = board && values.__cms_board_display === 'first-eight' && keys.length > 8
    if (board && keys.length) out.push({ kind: 'html', value: '<div class="core-grid">' })
    if (keys.length === 0 && preview) {
      out.push({
        kind: 'html',
        value:
          `<cms-slot data-cms-slot="${escapeAttribute(node.slotId)}" data-cms-kind="repeat" class="cms-repeat-empty">` +
          `This list is empty. Add ${/^[aeiou]/i.test(spec.unit) ? 'an' : 'a'} ${escapeText(spec.unit.toLowerCase())} from the panel.</cms-slot>`,
      })
    }
    keys.forEach((key, index) => {
      if (disclose && index === 8)
        out.push({
          kind: 'html',
          value: `</div><details class="core-board-more"><summary>Show all ${keys.length} board members</summary><div class="core-grid">`,
        })
      for (const part of body) {
        if (part.kind === 'html') {
          out.push(part)
          continue
        }
        const field = spec.fields.find(candidate => candidate.id === part.slotId)
        if (!field) continue
        const id = repeatItemSlotId(node.slotId, key, field.id)
        fields.set(id, { ...field, id, label: `${spec.unit} ${index + 1} · ${field.label}` })
        out.push({ ...part, slotId: id })
      }
    })
    if (board && keys.length) out.push({ kind: 'html', value: '</div>' + (disclose ? '</details>' : '') })
  }
  return { nodes: out, fields }
}

// Elements a block editor can be mounted in, as the importer groups them.
const RICHTEXT_HOSTS = new Set([
  'div',
  'section',
  'article',
  'aside',
  'main',
  'header',
  'footer',
  'nav',
  'blockquote',
  'li',
  'dd',
  'td',
  'th',
  'figure',
  'figcaption',
  'details',
])

/**
 * Rich-text fields that are the whole content of their element, keyed by the
 * slot's node index. In preview such a field is marked on that element instead
 * of being wrapped: a wrapper would sit between the element and its paragraphs,
 * so the section's own child rules (`.space-y-4 > * + *`, say) stopped matching
 * and the canvas showed different spacing from the published page.
 */
function richTextHosts(nodes: readonly AstNode[]): Map<number, string> {
  const hosts = new Map<number, string>()
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== 'slot' || node.slotKind !== 'richtext' || node.context !== 'element-text') continue
    const before = nodes[index - 1]
    const after = nodes[index + 1]
    if (before?.kind !== 'html' || after?.kind !== 'html') continue
    const opening = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*)?)>$/.exec(before.value)
    const tag = opening?.[1]?.toLowerCase()
    if (
      !opening ||
      !tag ||
      !RICHTEXT_HOSTS.has(tag) ||
      opening[2]!.includes('data-cms-') ||
      !after.value.toLowerCase().startsWith(`</${tag}>`)
    )
      continue
    hosts.set(index, node.slotId)
  }
  return hosts
}

/** Attach editor selection to the original element, never inside its URL. */
function instrumentTypedAttributes(nodes: readonly AstNode[]): AstNode[] {
  const template = nodes.map(node => (node.kind === 'html' ? node.value : `{{${node.slotId}}}`)).join('')
  const slots = nodes.filter((node): node is Extract<AstNode, { kind: 'slot' }> => node.kind === 'slot')
  const additions = new Map<number, string>()
  for (const [index, site] of scanSlotSites(template).entries()) {
    const node = slots[index]
    if (
      !node ||
      site.elementStart === undefined ||
      !isTypedAttributeBinding(node.slotKind, site.context, site.attribute)
    )
      continue
    const tag = /^<[a-zA-Z][a-zA-Z0-9:-]*/.exec(template.slice(site.elementStart))?.[0]
    if (!tag) continue
    const at = site.elementStart + tag.length
    if (!additions.has(at))
      additions.set(
        at,
        ` data-cms-slot="${escapeAttribute(node.slotId)}" data-cms-kind="${escapeAttribute(node.slotKind)}"`,
      )
  }
  let offset = 0
  return nodes.map(node => {
    if (node.kind !== 'html') {
      offset += node.slotId.length + 4
      return node
    }
    const start = offset
    offset += node.value.length
    let value = node.value
    for (const [at, addition] of [...additions].sort((a, b) => b[0] - a[0])) {
      if (at >= start && at < offset) value = value.slice(0, at - start) + addition + value.slice(at - start)
    }
    return { kind: 'html', value }
  })
}
