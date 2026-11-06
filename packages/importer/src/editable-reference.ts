// Preserve the legacy element tree while exposing its authored text regions.
// Every replacement uses the existing context-aware compiler; no script, tag,
// attribute name, or layout declaration becomes editor-controlled.
import { decodeHTML, decodeHTMLAttribute } from 'entities'
import { compileSection, sectionScopeSelector, sanitizeRichText } from '@cms/renderer'
import { ICON_PRESENTATION, isCmsIcon, SOURCE_DRAWING_PRESENTATION, type SlotDef } from '@cms/schema'
import { digest } from './backup.ts'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import { staticCompatibility } from './static-compatibility.ts'
import {
  acceptsRichTextBlocks,
  cohesiveRichText,
  isInlineRun,
  isRichTextBlock,
  isRichTextSeparator,
  type CohesiveRichText,
} from './cohesive-richtext.ts'
import { inferredFieldLabel } from './field-labels.ts'

export function editableReference(input: {
  slug: string
  html: string
  css: string
  /** Field names a source declares for its regions, by `data-block-id` (V1's registry). */
  labels?: ReadonlyMap<string, string>
  /** The code-owned drawings, by their markup: a drawn icon that is one becomes a choice of drawing (LIB-02 list items). */
  drawings?: ReadonlyMap<string, string>
}) {
  const checked = staticCompatibility(input)
  if (!checked.compiled) throw new Error('editable reference requires validated passive source')
  const parsed = parseHtml(input.html)
  if (!parsed.ok) throw new Error('editable reference could not be parsed')
  const slots: SlotDef[] = []
  const values: Record<string, unknown> = {}
  const issues = new Set<string>()
  const add = (
    key: string,
    kind: SlotDef['kind'],
    label: string,
    value: unknown,
    constraints: SlotDef['constraints'] = {},
    place?: Omit<Place, 'base'>,
  ) => {
    const id = `v1-${digest(key).slice(0, 24)}`
    slots.push({ id, kind, label, constraints })
    values[id] = value
    if (place) places.set(id, { base: label, ...place })
    return `{{${id}}}`
  }
  // Where a text field sits inside the region that names it: the repeated
  // containers above it ("card 2") and the element that holds its words. A
  // region split into several fields names each one by that, rather than
  // numbering “part 1, part 2…” in source order.
  const places = new Map<string, Place>()
  let elementCount = 0
  const labelFor = (node: HtmlElement) => {
    const authored = attribute(node, 'data-cms-label')
    if (authored !== undefined && decodeHTMLAttribute(authored).trim()) return decodeHTMLAttribute(authored).trim()
    const blockId = attribute(node, 'data-block-id')
    const declared = blockId !== undefined ? input.labels?.get(decodeHTMLAttribute(blockId))?.trim() : undefined
    if (declared) return declared
    return inferredFieldLabel(decodeHTMLAttribute(blockId ?? attribute(node, 'data-slot-id') ?? node.tag))
  }
  const richValue = (nodes: HtmlNode[], inline = false) => {
    const mapped = cohesiveRichText(nodes, { inline })
    if (mapped?.linkPolicyApplied) issues.add('richtext-link-policy-applied')
    return mapped ?? undefined
  }
  // A uniform source presentation for the field's blocks and marks travels
  // with its definition, so editors cannot drop it and the page keeps its look.
  const richConstraints = (mapped: CohesiveRichText): SlotDef['constraints'] => ({
    ...(mapped.inline ? { inline: true } : {}),
    ...(mapped.blockAttributes ? { blockAttributes: mapped.blockAttributes } : {}),
    ...(mapped.inlineAttributes ? { inlineAttributes: mapped.inlineAttributes } : {}),
  })
  const walkText = (
    nodes: HtmlNode[],
    key: string,
    label: string,
    parentTag: string,
    inPicture = false,
    inLink = false,
    within: Within = { path: [], role: null, element: 0 },
  ) => {
    const output: HtmlNode[] = []
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!
      // Keep adjacent authored paragraphs/lists in one field, including when
      // another part of the region needs a static styled wrapper or its own
      // image/link field. Do not add wrappers or consume a nested CMS boundary.
      if (!inLink && acceptsRichTextBlocks(parentTag) && isRichTextBlock(node)) {
        const run: HtmlNode[] = []
        let end = index
        while (end < nodes.length) {
          const candidate = nodes[end]!
          if (
            !isRichTextSeparator(candidate) &&
            (!isRichTextBlock(candidate) || !cohesiveRichText([candidate], { candidate: true }))
          )
            break
          run.push(candidate)
          end += 1
        }
        if (run.length) {
          const mapped = richValue(run)
          // A group must pass as a whole too. Never turn a failed comparison
          // into an undefined field value that would erase source content.
          if (mapped !== undefined) {
            // Named by its block when it is one paragraph, heading or list.
            const elements = run.filter((item): item is HtmlElement => item.kind === 'element')
            const role = elements.length === 1 ? (ROLES[elements[0]!.tag] ?? 'text') : 'text'
            output.push({
              kind: 'text',
              line: node.line,
              text: add(`${key}/richtext/${index}`, 'richtext', label, mapped.value, richConstraints(mapped), {
                path: within.path,
                role,
                element: ++elementCount,
              }),
            })
            index = end - 1
            continue
          }
        }
      }
      output.push(node)
      if (node.kind === 'text') {
        if (decodeHTML(node.text).trim())
          node.text = add(`${key}/text/${index}`, 'text', label, decodeHTML(node.text), {}, within)
      } else if (attribute(node, 'data-editable') !== undefined || node.tag === 'a') {
        // A parent text region does not own a nested field's destination or
        // image. Preserve that field's normal editor instead of flattening it.
        // Unnamed, it is named after the region rather than its tag (“A”).
        walk(
          [node],
          `${key}/nested/${index}`,
          inPicture,
          true,
          inLink,
          hasOwnLabel(node)
            ? undefined
            : [label, ...within.path, node.tag === 'a' ? 'link' : node.tag === 'img' ? 'image' : null]
                .filter(Boolean)
                .join(' · '),
        )
      } else if (!['svg', 'math', 'textarea', 'select', 'option'].includes(node.tag)) {
        // Nested formatting remains in the definition, so editing a sentence
        // does not discard its emphasis, line breaks, classes, or spacing.
        if (hasOwnLabel(node)) {
          walkText(
            node.children,
            `${key}/${index}`,
            labelFor(node),
            node.tag,
            inPicture || node.tag === 'picture',
            inLink,
          )
          continue
        }
        // A container repeated beside others like it (four stat cards) is
        // counted; the element holding the words names their role.
        const alike = nodes.filter((other): other is HtmlElement => other.kind === 'element' && other.tag === node.tag)
        const repeated = alike.length > 1 && node.children.some(child => child.kind === 'element' && child.tag !== 'br')
        const path = repeated
          ? [...within.path, `${REPEATED[node.tag] ?? 'group'} ${alike.indexOf(node) + 1}`]
          : within.path
        walkText(
          node.children,
          `${key}/${index}`,
          label,
          node.tag,
          inPicture || node.tag === 'picture',
          inLink,
          repeated
            ? { path, role: null, element: 0 }
            : { path, role: ROLES[node.tag] ?? 'text', element: ++elementCount },
        )
      }
    }
    nodes.splice(0, nodes.length, ...output)
  }
  const walk = (
    nodes: HtmlNode[],
    path: string,
    inPicture = false,
    inferLinks = false,
    inLink = false,
    unnamed?: string,
  ) => {
    for (const [index, node] of nodes.entries()) {
      if (node.kind === 'text') continue
      const key = `${path}/${index}`
      const editable = attribute(node, 'data-editable')
      const label = unnamed ?? labelFor(node)
      const withinLink = inLink || node.tag === 'a'
      if (editable === 'text' || editable === 'richtext') {
        const inner = serializeLegacy(node.children)
        const blocks =
          !withinLink &&
          acceptsRichTextBlocks(node.tag) &&
          node.children.some(isRichTextBlock) &&
          node.children.every(child => isRichTextBlock(child) || isRichTextSeparator(child))
        const canonicalFlow =
          editable === 'richtext' && !withinLink && acceptsRichTextBlocks(node.tag) && sanitizeRichText(inner) === inner
        // Even already-sanitized markup must pass the complete source-tree
        // comparison. Canonical markup can still contain destinationless
        // anchors that the visual editor cannot preserve.
        // Words with line breaks and styled emphasis inside a paragraph or
        // heading are one region in V1; they are one inline field here when
        // the field renders them back exactly.
        const mapped =
          blocks || canonicalFlow
            ? richValue(node.children)
            : !withinLink && isInlineRun(node.children)
              ? richValue(node.children, true)
              : undefined
        if (mapped !== undefined) {
          node.children = [
            { kind: 'text', line: node.line, text: add(key, 'richtext', label, mapped.value, richConstraints(mapped)) },
          ]
        } else {
          if (editable === 'richtext' && (withinLink || !acceptsRichTextBlocks(node.tag)))
            issues.add('inline-richtext-field-mapping-required')
          walkText(node.children, key, label, node.tag, inPicture || node.tag === 'picture', withinLink)
        }
      } else if ((editable === 'link' || inferLinks) && node.tag === 'a') {
        const href = node.attributes.find(attr => attr.name === 'href')
        if (href)
          href.value = add(
            `${key}/href`,
            'link',
            `${label} · destination`,
            { url: decodeHTMLAttribute(href.value) },
            { destinationOnly: true },
          )
        walkText(node.children, key, `${label} · label`, node.tag, inPicture, true)
      } else if (editable === 'image' && node.tag === 'img') {
        const src = node.attributes.find(attr => attr.name === 'src')
        const alt = node.attributes.find(attr => attr.name === 'alt')
        if (!src || !alt || inPicture || attribute(node, 'srcset') !== undefined) {
          issues.add(
            inPicture || attribute(node, 'srcset') !== undefined
              ? 'responsive-image-field-mapping-required'
              : 'image-field-mapping-required',
          )
          continue
        }
        const url = decodeHTMLAttribute(src.value)
        const media = /^\/media\/([0-9a-f-]{36})\/(original|wide|card|thumbnail)$/.exec(url)
        const description = decodeHTMLAttribute(alt.value)
        const token = add(`${key}/image`, 'image', label, {
          src: url,
          alt: description,
          decorative: description === '',
          ...(media ? { media_id: media[1], variant: media[2] } : {}),
        })
        src.value = token
        alt.value = token
        const role = node.attributes.find(attr => attr.name === 'role')
        if (role) role.value = token
        else node.attributes.push({ name: 'role', value: token })
      } else {
        if (editable === 'icon') {
          const icon = attribute(node, 'data-icon-name')
          // A source that draws its own icon keeps that drawing: the picker's
          // code-owned set draws differently, and a stock symbol must not stand
          // in for a distinctive source icon (SPEC §6.5, LIB-03). Only an
          // element that names an icon without drawing one takes the picker's.
          const drawn = node.children.some(child => child.kind === 'element')
          if (isCmsIcon(icon) && !drawn) {
            node.children = [
              {
                kind: 'text',
                line: node.line,
                text: add(`${key}/icon`, 'text', label, icon, { presentation: ICON_PRESENTATION }),
              },
            ]
            continue
          }
          // In a list item, each item draws its own: the source's drawing,
          // chosen by name from the code-owned set that holds it exactly.
          const drawing = drawn ? input.drawings?.get(serializeLegacy(node.children).trim()) : undefined
          if (drawing) {
            node.children = [
              {
                kind: 'text',
                line: node.line,
                text: add(`${key}/drawing`, 'text', label, drawing, { presentation: SOURCE_DRAWING_PRESENTATION }),
              },
            ]
            continue
          }
          issues.add(isCmsIcon(icon) ? 'icon-source-drawing-kept' : 'icon-field-mapping-required')
        }
        walk(node.children, key, inPicture || node.tag === 'picture', false, withinLink)
      }
    }
  }
  walk(parsed.nodes, 'root')
  nameParts(slots, places)
  const counts = new Map<string, number>()
  for (const slot of slots) counts.set(slot.label, (counts.get(slot.label) ?? 0) + 1)
  const occurrences = new Map<string, number>()
  for (const slot of slots) {
    if ((counts.get(slot.label) ?? 0) < 2) continue
    const part = (occurrences.get(slot.label) ?? 0) + 1
    occurrences.set(slot.label, part)
    slot.label = `${slot.label} · part ${part}`
  }
  const sourceHtml = serializeLegacy(parsed.nodes)
  const compiled = compileSection({
    sourceHtml,
    sourceCss: input.css,
    slots,
    scopeSelector: sectionScopeSelector(input.slug)!,
  })
  if (compiled.blocking.length || compiled.problems.some(problem => /slot|declared/.test(problem))) {
    throw new Error('editable reference failed context-aware compilation')
  }
  return { sourceHtml, compiled, slots, values, issues: [...issues].sort() }
}

type Within = { path: string[]; role: string | null; element: number }
type Place = Within & { base: string }

/** What the words of an element are, for naming one field of a split region. */
const ROLES: Record<string, string> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  p: 'paragraph',
  li: 'item',
  em: 'emphasis',
  i: 'emphasis',
  strong: 'bold text',
  b: 'bold text',
  mark: 'highlight',
  small: 'small print',
  u: 'underlined text',
  blockquote: 'quote',
  q: 'quote',
  cite: 'citation',
  figcaption: 'caption',
  caption: 'caption',
  label: 'label',
  button: 'button text',
  dt: 'term',
  dd: 'description',
  td: 'cell',
  th: 'heading cell',
  sup: 'superscript',
  sub: 'subscript',
  time: 'date',
  abbr: 'abbreviation',
  code: 'code',
  ul: 'list',
  ol: 'list',
}
/** What a repeated container is called when it is counted. */
const REPEATED: Record<string, string> = {
  li: 'item',
  tr: 'row',
  td: 'cell',
  th: 'cell',
  dl: 'list',
  ul: 'list',
  ol: 'list',
  figure: 'figure',
  article: 'card',
}

const hasOwnLabel = (node: HtmlElement) =>
  ['data-cms-label', 'data-block-id', 'data-slot-id'].some(name => attribute(node, name) !== undefined)

/**
 * Name the fields of a region whose words had to become several fields: the
 * region's own words keep its name, and every other field adds where it is and
 * what it is — “Insights stats · card 2 · text 1”, “Hero subtitle · emphasis”.
 * A role is numbered only when several elements in the same place share it.
 * Identity is unaffected: field ids come from the element path, not the name.
 */
function nameParts(slots: SlotDef[], places: Map<string, Place>) {
  const regions = new Map<string, SlotDef[]>()
  for (const slot of slots) {
    const place = places.get(slot.id)
    if (place) regions.set(place.base, [...(regions.get(place.base) ?? []), slot])
  }
  for (const [base, fields] of regions) {
    if (fields.length < 2) continue
    const where = (place: Place) => `${place.path.join(' · ')}\u0000${place.role}`
    const elements = new Map<string, number[]>()
    for (const field of fields) {
      const place = places.get(field.id)!
      const seen = elements.get(where(place)) ?? []
      if (!seen.includes(place.element)) seen.push(place.element)
      elements.set(where(place), seen)
    }
    for (const field of fields) {
      const place = places.get(field.id)!
      const seen = elements.get(where(place))!
      const role =
        place.role === null ? null : seen.length > 1 ? `${place.role} ${seen.indexOf(place.element) + 1}` : place.role
      field.label = [base, ...place.path, role].filter(Boolean).join(' · ')
    }
  }
}
