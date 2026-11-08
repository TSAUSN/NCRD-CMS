/** The three repeated patterns in the approved offline BT2027 copy. This is
 * deliberately a closed conversion, not a general pattern detector. The
 * already reviewed template keeps its classes, data attributes and scripts. */
import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import { CollectionModel, parseCollectionEntryValues, type CollectionField, type SlotDef } from '@cms/schema'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
type Parent = DefaultTreeAdapterMap['parentNode']
export type BetterTogetherListKind = 'speakers' | 'sponsors' | 'workshops'
export type BetterTogetherListConversion = {
  name: string
  readerKey: BetterTogetherListKind
  fields: CollectionField[]
  presentation: {
    schemaVersion: 1
    titleField: string
    subtitleField: string | null
    imageField: string | null
    groupField: string | null
  }
  entries: { id: null; stableKey: string; values: Record<string, unknown> }[]
  sourceHtml: string
  slots: SlotDef[]
  values: Record<string, unknown>
}
const attr = (node: Element, name: string) => node.attrs.find(row => row.name === name)?.value ?? ''
const has = (node: Element, name: string) => attr(node, 'class').split(/\s+/).includes(name)
function* walk(node: Node): Generator<Element> {
  if ('tagName' in node) yield node
  for (const child of 'childNodes' in node ? node.childNodes : []) yield* walk(child)
}
const text = (node: Node): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : ''
function find(node: Node, predicate: (node: Element) => boolean): Element {
  const found = [...walk(node)].find(predicate)
  if (!found) throw new Error('The original BT2027 item markup has changed. Review it before converting.')
  return found
}
function setText(node: Element, value: string) {
  node.childNodes = [{ nodeName: '#text', value, parentNode: node }]
}
function setAttr(node: Element, name: string, value: string) {
  const row = node.attrs.find(row => row.name === name)
  if (row) row.value = value
  else node.attrs.push({ name, value })
}
function tokenImage(node: Element, field: string) {
  setAttr(node, 'src', '{{' + field + '}}')
  setAttr(node, 'alt', '{{' + field + '}}')
}
const plain = (key: string, label: string, required = false): CollectionField => ({
  key,
  label,
  type: 'text',
  required,
})
const picture = (key: string, label: string): CollectionField => ({ key, label, type: 'image', required: false })
const image = (node: Element) => ({
  src: attr(node, 'src'),
  alt: attr(node, 'alt'),
  decorative: attr(node, 'alt') === '',
})
const binding = (readerKey: string, filter?: { field: string; value: string }) => ({
  readerKey,
  selection: { mode: 'automatic', limit: 200, ...(filter ? { filter } : {}) },
})
function field(id: string, kind: SlotDef['kind'], label: string): SlotDef {
  return { id, kind, label, constraints: {} }
}
function repeat(id: string, label: string, unit: string, fields: SlotDef[]): SlotDef {
  return { id, kind: 'repeat', label, constraints: { collection: true, item: { unit, fields } } }
}
function replaceItems(parent: Parent, items: Element[]) {
  const first = parent.childNodes.indexOf(items[0]!)
  const last = parent.childNodes.indexOf(items.at(-1)!)
  if (first < 0 || last < first || items.some(item => item.parentNode !== parent))
    throw new Error('The original items no longer share their container.')
  if (parent.childNodes.slice(first, last + 1).some(node => 'tagName' in node && !items.includes(node)))
    throw new Error('Review the changed content between the original items.')
  // A comment is a serialization placeholder, never stored executable markup.
  parent.childNodes.splice(first, last - first + 1, {
    nodeName: '#comment',
    data: 'BT-NATIVE-LIST',
    parentNode: parent,
  })
}

/** `renderedHtml` is the matching local CMS output, before JavaScript, so its
 * image addresses already belong to the site. No source files or URLs are read. */
export function convertBetterTogetherList(input: {
  kind: BetterTogetherListKind
  sourceHtml: string
  renderedHtml: string
  slots: SlotDef[]
  values: Record<string, unknown>
}): BetterTogetherListConversion {
  const source = parseFragment(input.sourceHtml)
  const rendered = parseFragment(input.renderedHtml)
  const kind = input.kind
  const entries: BetterTogetherListConversion['entries'] = []
  const slots: SlotDef[] = []
  const values: Record<string, unknown> = {}
  let fields: CollectionField[]
  let presentation: BetterTogetherListConversion['presentation']
  let sourceHtml: string
  let name: string
  const commitParent = (parent: Parent, items: Element[], replacement: string) => {
    // Serialize the whole original root, replacing only the item range. Keeping
    // the other authored fields means the heading remains click-to-edit.
    replaceItems(parent, items)
    return serialize(source).replace('<!--BT-NATIVE-LIST-->', replacement)
  }
  if (kind === 'speakers') {
    name = 'Speakers'
    fields = [
      plain('name', 'Name', true),
      plain('role', 'Role'),
      { key: 'bio', label: 'About this speaker', type: 'richtext', required: false },
      picture('photo', 'Photo'),
      {
        ...plain('anchor', 'Link name'),
        help: 'Optional: a name used by a direct link to this speaker. Leave blank for a new speaker.',
      },
    ]
    presentation = {
      schemaVersion: 1,
      titleField: 'name',
      subtitleField: 'role',
      imageField: 'photo',
      groupField: null,
    }
    const items = [...walk(source)].filter(node => has(node, 'speaker-col'))
    const shown = [...walk(rendered)].filter(node => has(node, 'speaker-col'))
    if (items.length !== 6 || shown.length !== 6) throw new Error('Expected the six original BT2027 speakers.')
    shown.forEach((node, index) =>
      entries.push({
        id: null,
        stableKey: 'speaker-' + (index + 1),
        values: {
          name: text(find(node, n => n.tagName === 'h5')),
          role: text(find(node, n => has(n, 'speaker-role'))),
          bio: serializeOuter(
            find(
              find(node, n => has(n, 'speaker-bio')),
              n => n.tagName === 'p',
            ),
          ),
          photo: image(find(node, n => n.tagName === 'img')),
          anchor: attr(node, 'id'),
        },
      }),
    )
    const prototype = items[0]!
    const bio = find(prototype, n => has(n, 'speaker-bio'))
    const paragraph = find(bio, n => n.tagName === 'p')
    setAttr(prototype, 'id', '{{anchor}}')
    tokenImage(
      find(prototype, n => n.tagName === 'img'),
      'photo',
    )
    setText(
      find(prototype, n => n.tagName === 'h5'),
      '{{name}}',
    )
    setText(
      find(prototype, n => has(n, 'speaker-role')),
      '{{role}}',
    )
    bio.childNodes.splice(bio.childNodes.indexOf(paragraph), 1, {
      nodeName: '#text',
      value: '{{bio}}',
      parentNode: bio,
    })
    slots.push(
      repeat('speakers', 'Speakers', 'Speaker', [
        field('name', 'text', 'Name'),
        field('role', 'text', 'Role'),
        field('bio', 'richtext', 'About this speaker'),
        field('photo', 'image', 'Photo'),
        field('anchor', 'text', 'Link name'),
      ]),
    )
    values.speakers = binding(kind)
    sourceHtml = commitParent(
      prototype.parentNode!,
      items,
      '{{#speakers}}' + serializeOuter(prototype) + '{{/speakers}}',
    )
  } else if (kind === 'sponsors') {
    name = 'Sponsors'
    const items = [...walk(source)].filter(node => has(node, 'sponsor-card'))
    const shown = [...walk(rendered)].filter(node => has(node, 'sponsor-card'))
    if (items.length !== 8 || shown.length !== 8) throw new Error('Expected the eight original BT2027 sponsors.')
    const tiers = [...new Set(shown.map(node => text(find(node, n => has(n, 'sponsor-card-tag')))))]
    fields = [
      plain('name', 'Sponsor name', true),
      picture('logo', 'Logo'),
      { key: 'tier', label: 'Sponsorship level', type: 'select', required: true, options: tiers },
    ]
    presentation = {
      schemaVersion: 1,
      titleField: 'name',
      subtitleField: 'tier',
      imageField: 'logo',
      groupField: 'tier',
    }
    shown.forEach((node, index) => {
      const logo = image(find(node, n => n.tagName === 'img'))
      const tier = text(find(node, n => has(n, 'sponsor-card-tag')))
      entries.push({
        id: null,
        stableKey: 'sponsor-' + (index + 1),
        values: { name: logo.alt === 'Sponsor' ? tier + ' sponsor ' + (index + 1) : logo.alt, logo, tier },
      })
    })
    const templates = tiers
      .map((tier, index) => {
        const prototype = items[shown.findIndex(node => text(find(node, n => has(n, 'sponsor-card-tag'))) === tier)]!
        const id = 'sponsors' + (index + 1)
        tokenImage(
          find(prototype, n => n.tagName === 'img'),
          'logo',
        )
        setText(
          find(prototype, n => has(n, 'sponsor-card-tag')),
          '{{tier}}',
        )
        slots.push(
          repeat(id, tier, 'Sponsor', [field('logo', 'image', 'Logo'), field('tier', 'text', 'Sponsorship level')]),
        )
        values[id] = binding(kind, { field: 'tier', value: tier })
        return '{{#' + id + '}}' + serializeOuter(prototype) + '{{/' + id + '}}'
      })
      .join('\n')
    sourceHtml = commitParent(items[0]!.parentNode!, items, templates)
  } else {
    name = 'Workshops'
    fields = [
      plain('title', 'Workshop title'),
      plain('presenter', 'Presenter'),
      plain('focus', 'Conference focus'),
      plain('time', 'Day and time'),
    ]
    presentation = {
      schemaVersion: 1,
      titleField: 'title',
      subtitleField: 'presenter',
      imageField: null,
      groupField: 'focus',
    }
    const tbody = find(source, n => n.tagName === 'tbody')
    const rows = tbody.childNodes.filter((n): n is Element => 'tagName' in n && n.tagName === 'tr')
    const shown = find(rendered, n => n.tagName === 'tbody').childNodes.filter(
      (n): n is Element => 'tagName' in n && n.tagName === 'tr',
    )
    if (rows.length !== 125 || shown.length !== 125) throw new Error('Expected the125 original BT workshop rows.')
    const keys = ['title', 'presenter', 'focus', 'time']
    shown.forEach((row, index) => {
      const cells = row.childNodes.filter((n): n is Element => 'tagName' in n)
      if (cells.length !== 4 || cells.some(cell => cell.childNodes.some(n => 'tagName' in n)))
        throw new Error('Review the changed original workshop cells.')
      entries.push({
        id: null,
        stableKey: 'workshop-' + (index + 1),
        values: Object.fromEntries(cells.map((cell, i) => [keys[i]!, text(cell)])),
      })
    })
    const prototype = rows[0]!
    const cells = prototype.childNodes.filter((n): n is Element => 'tagName' in n)
    cells.forEach((cell, i) => setText(cell, '{{' + keys[i] + '}}'))
    slots.push(
      repeat(
        'workshops',
        'Workshops',
        'Workshop',
        fields.map(column => field(column.key, 'text', column.label)),
      ),
    )
    values.workshops = binding(kind)
    sourceHtml = commitParent(tbody, rows, '{{#workshops}}' + serializeOuter(prototype) + '{{/workshops}}')
  }
  CollectionModel.parse({ fields, presentation })
  for (const entry of entries) {
    const result = parseCollectionEntryValues(fields, entry.values)
    if (!result.ok) throw new Error(result.problems.join(' '))
  }
  // Keep every original field outside the converted repeated items.
  const used = new Set([...sourceHtml.matchAll(/\{\{([a-z][a-z0-9_-]*)\}\}/g)].map(match => match[1]))
  for (const slot of input.slots)
    if (used.has(slot.id)) {
      slots.push(slot)
      if (Object.hasOwn(input.values, slot.id)) values[slot.id] = input.values[slot.id]
    }
  return { name, readerKey: kind, fields, presentation, entries, sourceHtml, slots, values }
}
