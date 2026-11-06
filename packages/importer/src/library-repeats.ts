// V1's repeated units as a list an editor can grow, shrink and reorder
// (LIB-02, SPEC §6.14). V1 wrote a section's cards, steps or rows as numbered
// copies (`feature-1-title`, `feature-2-title`, …) and offered no way to add or
// remove one. Where the copies are identical siblings, the section is adapted
// to a `repeat` field: the first copy's markup becomes the item template
// between `{{#list}}` and `{{/list}}`, each copy's words and pictures become
// one starting item, and the adaptation is offered only when it renders back to
// V1's markup (whitespace between copies aside, which a browser collapses).
//
// The numbered fields of the faithful mapping are recorded beside the list
// (`item.from`), so a page that already uses the numbered version can move to
// the list without losing what an editor wrote in it.
import { compileSection, renderSection, sectionScopeSelector } from '@cms/renderer'
import {
  isDrawingSlot,
  REPEAT_ITEM_FIELD_KINDS,
  SLOT_ID,
  SOURCE_DRAWINGS,
  sourceSampleValues,
  type SlotDef,
} from '@cms/schema'
import { editableReference } from './editable-reference.ts'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import { sampleFor, withSourceSamples } from './source-samples.ts'

const NUMBERED = /^(.*?)-(\d+)(-.*)?$/
const MAX_ITEMS = 24
const DRAWINGS: ReadonlyMap<string, string> = new Map(
  Object.entries(SOURCE_DRAWINGS).map(([key, drawing]) => [drawing.svg, key]),
)

type Unit = {
  element: HtmlElement
  number: number
  signature: string
  parts: { prefix: string; suffix: string; blockId: string }[]
}
type Run = { siblings: HtmlNode[]; units: Unit[] }

export type RepeatAdaptation = {
  sourceHtml: string
  slots: SlotDef[]
  compiled: ReturnType<typeof compileSection>
  /** One per adapted list: its id, what an item is called, and how many items V1 had. */
  lists: { id: string; unit: string; items: number }[]
  /** The section's own fields' values as the source holds them (lists excluded). */
  values: Record<string, unknown>
}

/** The editable regions an element holds, by V1's ids (a named but static element is not one). */
function blockIds(element: HtmlElement): string[] {
  const own = attribute(element, 'data-editable') !== undefined ? attribute(element, 'data-block-id') : undefined
  return [
    ...(own ? [own] : []),
    ...element.children.flatMap(child => (child.kind === 'element' ? blockIds(child) : [])),
  ]
}

/** A sibling that is one numbered copy: every field inside it carries the same number, and nothing else does. */
function unitOf(element: HtmlElement): Unit | null {
  const ids = blockIds(element)
  if (ids.length === 0) return null
  const parts = ids.map(blockId => {
    const match = NUMBERED.exec(blockId)
    return match ? { prefix: match[1]!, number: Number(match[2]), suffix: match[3] ?? '', blockId } : null
  })
  if (parts.some(part => part === null)) return null
  const numbers = new Set(parts.map(part => part!.number))
  if (numbers.size !== 1) return null
  const shaped = parts.map(part => ({ prefix: part!.prefix, suffix: part!.suffix, blockId: part!.blockId }))
  return {
    element,
    number: parts[0]!.number,
    parts: shaped,
    signature: shaped.map(part => `${part.prefix}|${part.suffix}`).join(','),
  }
}

/** Runs of two or more identical numbered sibling copies, outermost first, never inside an editable region. */
function findRuns(nodes: HtmlNode[], runs: Run[] = []): Run[] {
  // Each call walks the same tree the same way, so a run's index names the same run every time.
  let run: Unit[] = []
  const flush = () => {
    if (run.length >= 2) runs.push({ siblings: nodes, units: run })
    run = []
  }
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    const unit = unitOf(node)
    const previous = run.at(-1)
    if (
      unit &&
      previous &&
      unit.number === previous.number + 1 &&
      unit.signature === previous.signature &&
      node.tag === previous.element.tag &&
      attribute(node, 'class') === attribute(previous.element, 'class')
    ) {
      run.push(unit)
      continue
    }
    flush()
    if (unit) {
      run = [unit]
      continue
    }
    if (attribute(node, 'data-editable') === undefined) findRuns(node.children, runs)
  }
  flush()
  return runs
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
function fieldIdFor(label: string, taken: Set<string>, room: number): string {
  let base = slug(label).replace(/--+/g, '-').slice(0, room) || 'field'
  if (!/^[a-z]/.test(base)) base = `f-${base}`.slice(0, room)
  base = base.replace(/-+$/g, '')
  let id = base,
    n = 2
  while (taken.has(id)) id = `${base.slice(0, room - String(n).length - 1)}-${n++}`
  taken.add(id)
  return id
}

/** “Card 1 Title” → unit “Card”, field “Title”; “Question 1” → field “Question”. */
function splitLabel(label: string | undefined): { unit: string; field: string } | null {
  const match = label ? /^(.*?)\s*\b\d+\b\s*(.*)$/.exec(label.trim()) : null
  if (!match) return null
  return { unit: match[1]!.trim(), field: match[2]!.trim() || match[1]!.trim() }
}

/** V1's abbreviations, for sections that carry no field names of their own (page imports). */
const WORDS: Record<string, string> = {
  faq: 'question',
  faqacc: 'question',
  faqlist: 'question',
  q: 'question',
  a: 'answer',
  sp: 'speaker',
  dl: 'download',
  desc: 'description',
  img: 'image',
  bstat: 'stat',
  accr: 'badge',
  richcols: 'column',
  cta: 'link',
  bio: 'biography',
  col: 'column',
}
/** `faq-q` → “Question”, `-desc` → “Description”: a readable name from V1's id parts. */
function wordsFor(id: string): string {
  const words = id
    .replace(/^-/, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => WORDS[word.toLowerCase()] ?? word)
  const unique = words.filter((word, index) => words.indexOf(word) === index)
  return unique.join(' ').replace(/^./, c => c.toUpperCase())
}

const IRREGULAR: Record<string, string> = {
  criterion: 'criteria',
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
}
/** What a list of units is called: “Cards”, “People”; a unit that is not a noun (“Related”) makes a “… list”. */
function plural(unit: string): string {
  const words = unit.split(' '),
    last = words.at(-1)!,
    lower = last.toLowerCase()
  const keepCase = (word: string) =>
    last[0] === last[0]!.toUpperCase() ? word.replace(/^./, c => c.toUpperCase()) : word
  if (IRREGULAR[lower]) return [...words.slice(0, -1), keepCase(IRREGULAR[lower])].join(' ')
  if (/(ed|ing)$/i.test(last) || ['share', 'related', 'featured'].includes(lower)) return `${unit} list`
  const many = /(s|x|ch|sh)$/i.test(last)
    ? `${last}es`
    : /[^aeiou]y$/i.test(last)
      ? `${last.slice(0, -1)}ies`
      : `${last}s`
  return [...words.slice(0, -1), many].join(' ')
}

/** Equal as a browser shows them: the image field's role, a bare `&`, whitespace runs and V1's
 * editing hooks (`data-block-id`, which no V1 stylesheet selects on) aside. */
export function rendersAlike(rendered: string, source: string): boolean {
  const normal = (value: string) =>
    value
      .replace(/ role="(presentation)?"/g, '')
      .replace(/ data-block-id="[^"]*"/g, '')
      .replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, '&amp;')
      .replace(/\s+/g, ' ')
      .replace(/> </g, '><')
      .trim()
  return normal(rendered) === normal(source)
}

const tokensIn = (html: string) => [...new Set([...html.matchAll(/\{\{([\w-]+)\}\}/g)].map(match => match[1]!))]

/**
 * Adapt a section's identical numbered copies to repeated lists, or return
 * null when it has none or the adaptation would not be faithful. `numbered`
 * is the section's faithful mapping with its numbered fields, for `item.from`.
 */
export function adaptRepeats(input: {
  slug: string
  html: string
  css: string
  labels?: ReadonlyMap<string, string>
  numbered: { sourceHtml: string; slots: readonly SlotDef[] }
  /** Told why a section with numbered copies stays numbered. */
  explain?: (reason: string) => void
}): RepeatAdaptation | null {
  const original = parseHtml(input.html)
  if (!original.ok) return null
  const count = findRuns(original.nodes).length
  if (count === 0) return null
  const done = (result: Attempt): result is RepeatAdaptation => 'sourceHtml' in result
  // A run that fails on its own is left numbered and the rest tried again.
  const skip = new Set<number>()
  let result = attemptLists(input, original.nodes, skip)
  while (!done(result) && result.run !== undefined && skip.size < count - 1) {
    skip.add(result.run)
    result = attemptLists(input, original.nodes, skip)
  }
  if (done(result)) return result
  // Together they do not render back: the lists that do on their own, together, or the first alone.
  if (result.run === undefined && count - skip.size > 1) {
    const alone = [...Array(count).keys()]
      .filter(run => !skip.has(run))
      .filter(run =>
        done(attemptLists(input, original.nodes, new Set([...Array(count).keys()].filter(other => other !== run)))),
      )
    if (alone.length) {
      const together = attemptLists(
        input,
        original.nodes,
        new Set([...Array(count).keys()].filter(run => !alone.includes(run))),
      )
      if (done(together)) return together
      const first = attemptLists(
        input,
        original.nodes,
        new Set([...Array(count).keys()].filter(run => run !== alone[0])),
      )
      if (done(first)) return first
    }
  }
  input.explain?.(result.reason)
  return null
}

type Attempt = RepeatAdaptation | { reason: string; run?: number }

/** One attempt with the runs in `skip` left numbered. */
function attemptLists(
  input: Parameters<typeof adaptRepeats>[0],
  originalNodes: HtmlNode[],
  skip: ReadonlySet<number>,
): Attempt {
  // The template: each run reduced to one copy between two sentinels, its
  // fields renamed by their part. `variant` puts copy `k` of run `r` there instead.
  const build = (variant?: { run: number; unit: number }) => {
    const parsed = parseHtml(input.html)
    if (!parsed.ok) return null
    const runs = findRuns(parsed.nodes)
      .map((run, index) => ({ run, index }))
      .filter(({ index }) => !skip.has(index))
    const labels = new Map(input.labels ?? [])
    const meta = runs.map(({ run, index }, r) => {
      const first = run.units[0]!
      const chosen = variant && variant.run === r ? run.units[variant.unit]! : first
      // Rename the chosen copy's fields to their part, labelled without the number.
      const renameFields = (element: HtmlElement) => {
        const blockId = attribute(element, 'data-block-id')
        if (blockId !== undefined) {
          const index = chosen.parts.findIndex(part => part.blockId === blockId)
          const renamed = `cmsitem${r}-p${index}`
          const v1 = splitLabel(input.labels?.get(first.parts[index]!.blockId))
          labels.set(renamed, v1?.field || wordsFor(first.parts[index]!.suffix || first.parts[index]!.prefix))
          element.attributes = element.attributes.map(a => (a.name === 'data-block-id' ? { ...a, value: renamed } : a))
        }
        for (const child of element.children) if (child.kind === 'element') renameFields(child)
      }
      renameFields(chosen.element)
      const start = run.siblings.indexOf(first.element),
        end = run.siblings.indexOf(run.units.at(-1)!.element)
      const after = run.siblings[start + 1]
      const separator = after?.kind === 'text' && after.text.trim() === '' ? after.text : ''
      run.siblings.splice(
        start,
        end - start + 1,
        { kind: 'text', line: first.element.line, text: `__cms_repeat_${r}_start__` },
        chosen.element,
        { kind: 'text', line: first.element.line, text: `${separator}__cms_repeat_${r}_end__` },
      )
      const unit = splitLabel(input.labels?.get(first.parts[0]!.blockId))?.unit || wordsFor(first.parts[0]!.prefix)
      return {
        prefix: first.parts[0]!.prefix,
        unit: unit.replace(/^./, c => c.toUpperCase()),
        count: run.units.length,
        index,
      }
    })
    try {
      const mapped = editableReference({
        slug: input.slug,
        html: serializeLegacy(parsed.nodes),
        css: input.css,
        labels,
        drawings: DRAWINGS,
      })
      return { mapped, meta }
    } catch {
      return null
    }
  }

  const template = build()
  if (!template) return { reason: 'its one-copy template could not be mapped' }
  const { mapped, meta } = template
  let sourceHtml = mapped.sourceHtml
  const regions = meta.map((_, r) => {
    const start = `__cms_repeat_${r}_start__`,
      end = `__cms_repeat_${r}_end__`
    const from = sourceHtml.indexOf(start),
      to = sourceHtml.indexOf(end)
    if (from < 0 || to < from || sourceHtml.indexOf(start, from + 1) >= 0 || sourceHtml.indexOf(end, to + 1) >= 0)
      return null
    return { ids: tokensIn(sourceHtml.slice(from, to)), from, to }
  })
  const lost = regions.findIndex(region => region === null || region.ids.length === 0)
  if (lost >= 0) return { reason: 'a copy lost its place or its fields in the mapping', run: meta[lost]!.index }

  const regionIds = new Set(regions.flatMap(region => region!.ids))
  const slotById = new Map(mapped.slots.map(slot => [slot.id, slot]))
  const topSamples = withSourceSamples(
    mapped.slots.filter(slot => !regionIds.has(slot.id)),
    mapped.values,
  )
  const listIds = new Set<string>()
  const lists = meta.map((list, r) => {
    let id = slug(list.prefix).slice(0, 20).replace(/-+$/, '') || 'items'
    if (!SLOT_ID.test(id)) id = `items-${r + 1}`
    while (listIds.has(id) || slotById.has(id)) id = `${id.slice(0, 16)}-${r + 1}`
    listIds.add(id)
    const room = 64 - id.length - 12
    const taken = new Set<string>()
    const fields = regions[r]!.ids.map(slotId => {
      const slot = slotById.get(slotId)!
      const { sourceSample: _sample, ...constraints } = slot.constraints ?? {}
      return {
        from: slotId,
        field: { id: fieldIdFor(slot.label, taken, room), kind: slot.kind, label: slot.label, constraints },
      }
    })
    return { id, unit: list.unit, count: list.count, fields }
  })
  const unfit = lists.findIndex(list =>
    list.fields.some(({ field }) => !(REPEAT_ITEM_FIELD_KINDS as readonly string[]).includes(field.kind)),
  )
  if (unfit >= 0) return { reason: 'a copy holds a field an item cannot have', run: meta[unfit]!.index }

  // Each copy's own words and pictures, read through the same mapping: a copy
  // in the template's place has the template's field ids.
  const samples: Record<string, unknown>[][] = []
  for (const [r, list] of lists.entries()) {
    samples[r] = []
    for (let k = 0; k < list.count; k += 1) {
      const copy = k === 0 ? template : build({ run: r, unit: k })
      if (!copy) return { reason: `copy ${k + 1} could not be mapped`, run: meta[r]!.index }
      const ids = tokensIn(
        copy.mapped.sourceHtml.slice(
          copy.mapped.sourceHtml.indexOf(`__cms_repeat_${r}_start__`),
          copy.mapped.sourceHtml.indexOf(`__cms_repeat_${r}_end__`),
        ),
      )
      if (ids.join() !== list.fields.map(({ from }) => from).join())
        return { reason: `copy ${k + 1} does not have the first copy's fields`, run: meta[r]!.index }
      samples[r]!.push(
        Object.fromEntries(
          list.fields
            .map(({ from, field }) => [field.id, sampleFor(field, copy.mapped.values[from])])
            .filter(([, value]) => value !== undefined),
        ),
      )
    }
  }

  // The numbered fields each item replaces, by document order: every copy
  // gives the same fields in the same order. A drawing field is new (the
  // numbered version kept the drawing as markup), so it has no counterpart.
  const numberedOrder = tokensIn(input.numbered.sourceHtml)
  const numberedKind = new Map(input.numbered.slots.map(slot => [slot.id, slot.kind]))
  const legacy: Record<string, string>[][] = lists.map(() => [])
  let pointer = 0,
    consistent = true
  const outside = tokensIn(
    sourceHtml.replace(/__cms_repeat_(\d+)_start__[\s\S]*?__cms_repeat_\1_end__/g, (_, r) => `{{__list_${r}__}}`),
  ).filter(token => {
    const slot = slotById.get(token)
    return !slot || !isDrawingSlot(slot)
  })
  for (const token of outside) {
    const list = /^__list_(\d+)__$/.exec(token)
    if (!list) {
      pointer += 1
      continue
    }
    const r = Number(list[1]),
      entry = lists[r]!
    const carried = entry.fields.filter(({ field }) => !isDrawingSlot(field))
    for (let k = 0; k < entry.count; k += 1) {
      const ids = numberedOrder.slice(pointer + k * carried.length, pointer + (k + 1) * carried.length)
      if (ids.length !== carried.length || ids.some((id, j) => numberedKind.get(id) !== carried[j]!.field.kind))
        consistent = false
      legacy[r]!.push(Object.fromEntries(carried.map(({ field }, j) => [field.id, ids[j]!])))
    }
    pointer += entry.count * carried.length
  }
  if (pointer !== numberedOrder.length) consistent = false

  for (const [r, list] of lists.entries()) {
    const start = `__cms_repeat_${r}_start__`,
      end = `__cms_repeat_${r}_end__`
    const from = sourceHtml.indexOf(start),
      to = sourceHtml.indexOf(end) + end.length
    let body = sourceHtml.slice(from + start.length, to - end.length)
    for (const { from: slotId, field } of list.fields) body = body.replaceAll(`{{${slotId}}}`, `{{${field.id}}}`)
    // V1's editing hooks named each copy's regions; an item's fields are named by the list.
    body = body.replace(new RegExp(` data-block-id="cmsitem${r}-p\\d+"`, 'g'), '')
    sourceHtml = `${sourceHtml.slice(0, from)}{{#${list.id}}}${body}{{/${list.id}}}${sourceHtml.slice(to)}`
  }

  // The section's own fields, with each list where its first field was.
  const slots: SlotDef[] = []
  const placed = new Set<number>()
  for (const slot of mapped.slots) {
    if (!regionIds.has(slot.id)) {
      slots.push(topSamples.find(candidate => candidate.id === slot.id)!)
      continue
    }
    const r = lists.findIndex(list => list.fields.some(({ from }) => from === slot.id))
    if (placed.has(r)) continue
    placed.add(r)
    const list = lists[r]!
    slots.push({
      id: list.id,
      kind: 'repeat',
      label: plural(list.unit),
      constraints: {
        item: {
          unit: list.unit,
          min: 1,
          max: Math.min(MAX_ITEMS, Math.max(12, list.count * 2)),
          fields: list.fields.map(({ field }) => field),
          samples: samples[r]!,
          ...(consistent ? { from: legacy[r]! } : {}),
        },
      },
    })
  }

  const compiled = compileSection({
    sourceHtml,
    sourceCss: input.css,
    slots,
    scopeSelector: sectionScopeSelector(input.slug)!,
  })
  // Notes the section's stylesheet already drew in its numbered form are not the list's to answer.
  const introduced = compiled.problems.filter(problem => !mapped.compiled.problems.includes(problem))
  if (compiled.blocking.length || introduced.length)
    return { reason: `the list did not compile (${[...compiled.blocking, ...introduced].join('; ')})` }
  const rendered = renderSection(
    {
      def: { section_def_id: input.slug, version: 1, slug: input.slug, compiled_ast: compiled.ast, slots },
      instance: { section_def_id: input.slug, section_def_version: 1, values: sourceSampleValues(slots) },
    } as Parameters<typeof renderSection>[0],
    0,
  )
    .replace(/^<div[^>]*>/, '')
    .replace(/<\/div>$/, '')
  if (!rendersAlike(rendered, serializeLegacy(originalNodes)))
    return { reason: 'the list does not render back to the source' }
  return {
    sourceHtml,
    slots,
    compiled,
    lists: lists.map(list => ({ id: list.id, unit: list.unit, items: list.count })),
    values: Object.fromEntries(Object.entries(mapped.values).filter(([id]) => !regionIds.has(id))),
  }
}
