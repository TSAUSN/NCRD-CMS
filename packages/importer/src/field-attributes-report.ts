// The field-attribute inventory, as bytes.
//
// Three renderings again — JSON for a program, CSV for a spreadsheet, Markdown
// for whoever writes the schema-v2 ADR — under the same two rules `report.ts`
// works under. No V1 markup, no V1 CSS, no V1 copy: the only V1 strings that
// reach these files are definition ids, attribute names, and the HTML keywords
// (`lazy`, `async`, `_blank`) that are the same in every document on the web. A
// class name never appears; a class list is a count of tokens.
//
// And byte-stability. The Markdown is generated rather than written by hand for
// exactly that reason: a hand-written summary quoting "77 definitions" is a
// number that stops being true the next time the catalogue moves and nothing
// says so, whereas a generated one either regenerates identically or shows up in
// a diff. Every number below comes from the inventory it is rendering.

import type { AllowlistStep, FieldAttributeInventory, FieldAttributeRow, FieldKind } from './field-attributes.ts'
import { CODE_BOUNDARY } from './field-attributes.ts'

/**
 * The machine-readable inventory.
 *
 * The literal is the schema, as in `report.ts`: key order is insertion order and
 * every object here is built by a literal, so two runs over the same inventory
 * serialize to the same bytes.
 */
export function inventoryJson(inventory: FieldAttributeInventory): string {
  return `${JSON.stringify(
    {
      importerVersion: inventory.importerVersion,
      inventoryVersion: inventory.inventoryVersion,
      runId: inventory.runId,
      sourceManifest: inventory.manifest,
      codeBoundary: CODE_BOUNDARY,
      counts: inventory.counts,
      absent: inventory.absent,
      attributes: inventory.attributes.map(row => ({
        fieldKind: row.fieldKind,
        name: row.name,
        valueShape: row.shape,
        occurrences: row.occurrences,
        definitions: row.definitions,
        bindings: row.bindings,
        ownership: row.ownership,
        effects: row.effects,
        anchorRole: row.anchorRole,
        consumedByField: row.consumedByField,
        inSelector: row.inSelector,
        wrapperSafe: row.wrapperSafe,
        expressible: row.expressible,
        verdict: row.verdict,
        definitionIds: row.definitionIds,
      })),
      allowlist: inventory.allowlist,
      remainingBlockers: inventory.remainingBlockers,
      definitions: inventory.definitions,
    },
    null,
    2,
  )}\n`
}

/** RFC 4180 quoting, the same spelling `report.ts` uses. */
function csvCell(value: string | number | boolean): string {
  return `"${String(value).split('"').join('""')}"`
}

const CSV_COLUMNS = [
  'field_kind',
  'attribute',
  'value_shape',
  'occurrences',
  'definitions',
  'bindings',
  'ownership',
  'effects',
  'anchor_role',
  'consumed_by_field',
  'in_css_selector',
  'wrapper_safe',
  'expressible',
  'verdict',
  'definition_ids',
] as const

export function inventoryCsv(inventory: FieldAttributeInventory): string {
  const rows = [CSV_COLUMNS.join(',')]
  for (const row of inventory.attributes) {
    rows.push(
      [
        row.fieldKind,
        row.name,
        row.shape,
        row.occurrences,
        row.definitions,
        row.bindings.join(' '),
        row.ownership,
        row.effects.join(' '),
        row.anchorRole,
        row.consumedByField,
        row.inSelector,
        row.wrapperSafe,
        row.expressible,
        row.verdict,
        // Space-joined in one cell, as `report.ts` joins reason codes: a column
        // count that depends on the data is not a CSV anybody can open twice.
        row.definitionIds.join(' '),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `${rows.join('\n')}\n`
}

// ------------------------------------------------------------- the Markdown

function table(headers: readonly string[], rows: readonly (string | number)[][]): string[] {
  const out = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`]
  for (const row of rows) out.push(`| ${row.map(String).join(' | ')} |`)
  return out
}

function attributeRows(rows: readonly FieldAttributeRow[], kind: FieldKind): (string | number)[][] {
  return rows
    .filter(row => row.fieldKind === kind)
    .map(row => [
      `\`${row.name}\``,
      `\`${row.shape}\``,
      row.occurrences,
      row.definitions,
      row.bindings.join(', '),
      row.ownership,
      row.effects.length === 0 ? '—' : row.effects.join(', '),
      row.anchorRole === 'none' ? '—' : row.anchorRole,
      row.inSelector > 0 ? `yes (${row.inSelector})` : 'no',
      row.consumedByField ? 'already carried' : row.verdict,
    ])
}

function allowlistRows(steps: readonly AllowlistStep[]): (string | number)[][] {
  return steps.map(step => [
    step.rank,
    step.added.map(name => `\`${name}\``).join(' + '),
    step.allowlist.length,
    step.newlyCleared,
    step.cumulativeCleared,
    step.cumulativeUnlocked,
    step.verdict,
  ])
}

/** English, so a table caption does not read "1 definitions". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** The step at which adding more attributes stops clearing anything new. */
function knee(steps: readonly AllowlistStep[]): AllowlistStep | undefined {
  let best: AllowlistStep | undefined
  for (const step of steps) {
    if (best === undefined || step.cumulativeCleared > best.cumulativeCleared) best = step
  }
  return best
}

/**
 * The design summary, aimed at whoever writes the schema-v2 ADR.
 *
 * Ordered the way that reader needs it: what the two codes are and why they are
 * not the same obstacle, then what is actually on the elements, then what a
 * given allowlist would buy, and only then a recommendation — which is last
 * because it is the only part that is a judgement rather than a count, and it
 * should be checkable against everything above it.
 */
export function inventoryMarkdown(inventory: FieldAttributeInventory): string {
  const lines: string[] = []
  const counts = inventory.counts
  const push = (...text: string[]): void => {
    lines.push(...text)
  }

  push('# What a link or image field node would lose', '')
  push(
    'Generated by `pnpm --filter @cms/importer inventory`. Every number here comes',
    'from the run named below; nothing in this file is written by hand, so a',
    'regeneration either produces identical bytes or shows the change in a diff.',
    '',
  )
  push(`- run \`${inventory.runId}\``)
  push(`- importer version ${inventory.importerVersion}, inventory version ${inventory.inventoryVersion}`)
  push(`- source manifest \`${inventory.manifest.sha256}\``)
  for (const file of inventory.manifest.files) {
    push(`  - \`${file.path}\` — \`${file.sha256.slice(0, 16)}\`, ${file.bytes} bytes`)
  }
  push('')

  push('## The question', '')
  push(
    '`field-attributes-lost` is the largest single obstacle in the catalogue and',
    'the least informative code the importer produces. This inventory exists to',
    'answer one question with evidence rather than with that number: **what is',
    'the smallest governed attribute allowlist that would unlock the most',
    'definitions?** The answer, stated up front because it is not the encouraging',
    'one, is at the bottom.',
    '',
  )

  push('## The two attribute codes are not the same obstacle', '')
  push(
    'They are counted separately everywhere below because they are about disjoint',
    'populations of *elements*. A definition carrying both has two problems, not',
    'one problem counted twice.',
    '',
  )
  for (const boundary of CODE_BOUNDARY) {
    push(`**\`${boundary.code}\`** — ${boundary.population}.`, '')
    push(boundary.sentence, '')
  }
  push(
    ...table(
      ['', 'definitions'],
      [
        ['`field-attributes-lost`', counts.fieldAttributesLostCode],
        ['`unsupported-attribute`', counts.unsupportedAttributeCode],
        ['both codes (the overlap)', counts.bothCodes],
        ['either code, overlap removed', counts.eitherCode],
        [
          'naive sum, which double-counts the overlap',
          counts.fieldAttributesLostCode + counts.unsupportedAttributeCode,
        ],
      ],
    ),
  )
  push('')
  push(
    `So the two codes together block **${counts.eitherCode}** definitions, not`,
    `${counts.fieldAttributesLostCode + counts.unsupportedAttributeCode}. Widening the *element-node*`,
    'allowlist — the `STRUCTURED_ATTRIBUTES` list — does nothing for',
    '`field-attributes-lost`, because a link or image field is not an element node',
    'and has no attribute map to widen. The two need different changes.',
    '',
  )
  push(
    `A third number matters for planning. **${counts.definitionsWithLoss}** definitions carry at least one`,
    `attribute a field node could not hold, but only **${counts.fieldAttributesLostCode}** are given the code:`,
    `the other **${counts.lostButNotCoded}** are refused at an earlier gate — a nested editable region, a`,
    'slot that disagrees with its region — so the converter never reaches their',
    "field element's attributes. Fixing attributes alone would not surface them;",
    'they are in the inventory so that the gap is visible rather than a discrepancy',
    'somebody rediscovers later.',
    '',
  )

  push('## What is actually on the elements', '')
  push(
    `${counts.linkFieldElements} link field elements across ${counts.definitionsWithLinkField} definitions;`,
    `${counts.imageFieldElements} image field elements across ${counts.definitionsWithImageField} definitions.`,
    'Every one is written on the element its type requires — no `link` on a',
    '`<span>`, no `image` on a `<div>`.',
    '',
  )
  push(
    'Values are reported as shapes, never as values: a class list is a token count,',
    'a URL is a category, an `alt` is `free-text`. The enum values named below are',
    'HTML keywords rather than anything read out of V1.',
    '',
  )

  const headers = [
    'attribute',
    'value shape',
    'occurrences',
    'definitions',
    'binding',
    'ownership',
    'affects',
    'anchor role',
    'in a selector',
    'verdict',
  ]

  push('### Link field nodes (`<a data-editable="link">`)', '')
  push(...table(headers, attributeRows(inventory.attributes, 'link')))
  push('')
  push(
    `Probed for and **absent** on every link field element: ${
      inventory.absent.link.map(name => `\`${name}\``).join(', ') || '—'
    }.`,
    '',
  )

  push('### Image field nodes (`<img data-editable="image">`)', '')
  push(...table(headers, attributeRows(inventory.attributes, 'image')))
  push('')
  push(
    `Probed for and **absent** on every image field element: ${
      inventory.absent.image.map(name => `\`${name}\``).join(', ') || '—'
    }.`,
    '',
  )

  push('## What a given allowlist would buy', '')
  push(
    'Greedy over **bundles**, not over names. Attributes arrive together: every',
    '`<img>` that carries `width` also carries `height` and `decoding`, so a',
    'ranking that added one name at a time would report that `height` clears',
    'nothing and `width` clears eight, and a reader following it would implement',
    'two attributes and unblock none. Each step below adds the smallest set that',
    'clears the most definitions not already clear.',
    '',
    '*Cleared* means every attribute that definition would lose is on the',
    'allowlist **and** expressible under a closed value grammar. *Unlocked* means',
    'it then has no reason code left at all — the only number that puts a section',
    'on a page. The curve stops when no further bundle clears anything.',
    '',
  )
  for (const [title, steps] of [
    ['Link field nodes', inventory.allowlist.link],
    ['Image field nodes', inventory.allowlist.image],
    ['Both together', inventory.allowlist.combined],
  ] as const) {
    push(`### ${title}`, '')
    push(
      ...table(
        ['#', 'attributes added', 'allowlist size', 'newly cleared', 'cleared so far', 'unlocked so far', 'verdict'],
        allowlistRows(steps),
      ),
    )
    push('')
  }
  push(
    `**${inventory.allowlist.unclearable.length}** definitions are cleared by no allowlist at any size, because`,
    'at least one of their losses has no closed grammar to accept: an inline',
    '`style` declaration list, or a `data-*` hook whose meaning lives in V1',
    'JavaScript this importer does not read.',
    '',
  )

  push('## Blocked by exactly one remaining thing', '')
  push(
    'Of the definitions a full attribute allowlist would clear, these are the ones',
    'left with a single reason code. Each row is a count of definitions that one',
    'further piece of work would import.',
    '',
  )
  if (inventory.remainingBlockers.length === 0) push('(none)', '')
  else {
    push(
      ...table(
        ['remaining code', 'definitions'],
        inventory.remainingBlockers.map(row => [`\`${row.code}\``, row.definitions]),
      ),
    )
    push('')
  }

  push('## Recommendation', '')
  push(...recommendation(inventory))
  return `${lines.join('\n')}\n`
}

/**
 * The ranked recommendation, computed rather than asserted.
 *
 * Every claim below is a number this inventory produced, so the recommendation
 * moves when the evidence does. The one judgement is `verdictFor`, which is
 * itself a rule over the evidence rather than a per-attribute opinion.
 *
 * The ranked list is the greedy curve truncated at the last step that clears a
 * definition, and only while every attribute that step adds is one worth
 * supporting. A step that would need an inline `style` accepted ends the list
 * and is reported as the thing it is: an unlock available only at a price the
 * model was designed not to pay.
 */
function recommendation(inventory: FieldAttributeInventory): string[] {
  const lines: string[] = []
  const push = (...text: string[]): void => {
    lines.push(...text)
  }

  // One entry per attribute *name*, not per value shape: `class` has six shapes
  // on link elements and one recommendation, and a list that named it six times
  // would read as six decisions.
  const bucket = (kind: FieldKind, verdict: string): FieldAttributeRow[] => {
    const rows = inventory.attributes.filter(
      row => row.fieldKind === kind && !row.consumedByField && row.verdict === verdict,
    )
    const byName = new Map<string, FieldAttributeRow>()
    for (const row of rows) {
      const seen = byName.get(row.name)
      if (seen === undefined) {
        byName.set(row.name, row)
        continue
      }
      byName.set(row.name, {
        ...seen,
        definitions: new Set([...seen.definitionIds, ...row.definitionIds]).size,
        definitionIds: [...new Set([...seen.definitionIds, ...row.definitionIds])].sort((a, b) =>
          a.localeCompare(b, 'en'),
        ),
      })
    }
    return [...byName.values()].sort((a, b) => b.definitions - a.definitions || a.name.localeCompare(b.name, 'en'))
  }

  for (const kind of ['link', 'image'] as const) {
    const steps = kind === 'link' ? inventory.allowlist.link : inventory.allowlist.image
    // Steps up to the first that would require accepting something this
    // inventory says should stay out. Truncating rather than filtering: the
    // steps are cumulative, so a later one is only reachable through the
    // earlier ones and cherry-picking would overstate what it clears.
    const affordable = steps.slice(
      0,
      steps.findIndex(step => step.verdict === 'quarantine') === -1
        ? steps.length
        : steps.findIndex(step => step.verdict === 'quarantine'),
    )
    const last = affordable[affordable.length - 1]
    const refused = steps[affordable.length]

    push(`### ${kind === 'link' ? 'Link' : 'Image'} field nodes`, '')
    if (last === undefined) {
      push('No attribute or bundle on this field kind clears a definition at an', 'acceptable price.', '')
    } else {
      push(
        '**Worth supporting**, in the order the evidence ranks them. Each row is a',
        'bundle: the definitions it clears need all of it, and none of them are',
        'cleared by a proper subset.',
        '',
      )
      push(
        ...table(
          ['#', 'add', 'clears (new)', 'clears (cumulative)', 'unlocks (cumulative)'],
          affordable.map(step => [
            step.rank,
            step.added.map(name => `\`${name}\``).join(' + '),
            step.newlyCleared,
            step.cumulativeCleared,
            step.cumulativeUnlocked,
          ]),
        ),
      )
      push('')
      push(
        `The whole recommended allowlist is ${last.allowlist.map(name => `\`${name}\``).join(', ')} —` +
          ` ${plural(last.allowlist.length, 'attribute', 'attributes')}.`,
        `It clears \`field-attributes-lost\` from ${plural(last.cumulativeCleared, 'definition', 'definitions')}` +
          ` and unlocks ${plural(last.cumulativeUnlocked, 'definition', 'definitions')} outright.`,
        '',
      )
      for (const name of last.allowlist) {
        const row = inventory.attributes.find(r => r.fieldKind === kind && r.name === name)
        if (row === undefined) continue
        push(
          `- \`${name}\` — ${row.ownership}; affects ${row.effects.join(', ') || 'nothing measurable'}; ` +
            `${grammarFor(name)}`,
        )
      }
      push('')
    }
    if (refused !== undefined) {
      push(
        `Going further would need ${refused.added.map(name => `\`${name}\``).join(' + ')}, which this`,
        `inventory says should stay out. It would clear ${plural(refused.newlyCleared, 'more definition', 'more definitions')}`,
        `and unlock ${plural(refused.cumulativeUnlocked - (last?.cumulativeUnlocked ?? 0), 'more definition', 'more definitions')}.`,
        '',
      )
    }

    const stayOut = bucket(kind, 'quarantine')
    const supported = new Set(bucket(kind, 'support').map(row => row.name))
    push('**Should stay quarantined:**', '')
    if (stayOut.length === 0) push('- nothing on this field kind', '')
    for (const row of stayOut) {
      // A name can be recommended and quarantined at once, because the verdict
      // is per value shape: `class` is worth supporting and one definition
      // still writes a value no grammar this model would accept.
      const also = supported.has(row.name)
        ? ' It is also recommended above; these are the definitions the ' + 'recommendation does not reach.'
        : ''
      push(
        `- \`${row.name}\` (${plural(row.definitions, 'definition', 'definitions')}) — ` +
          `${quarantineWhy(row.name)}.${also}`,
      )
    }
    push('')

    const wrapper = bucket(kind, 'wrapper')
    if (wrapper.length > 0) {
      push(
        '**Needs no field-node feature.** A wrapper element node can carry these:',
        "no selector in the definition's own stylesheet or in `INTERACTION_PRESET_CSS`",
        'depends on them, and what they mean lives in V1 JavaScript rather than in the',
        'page. If v2 needs the hook at all, it is an element-node attribute question,',
        'not a field-node one.',
        '',
      )
      for (const row of wrapper) {
        push(`- \`${row.name}\` (${plural(row.definitions, 'definition', 'definitions')})`)
      }
      push('')
    }
  }

  const combined = knee(inventory.allowlist.combined)
  const unlocked = combined?.cumulativeUnlocked ?? 0
  const cleared = combined?.cumulativeCleared ?? 0
  push('### The honest bottom line', '')
  push(
    `A maximal attribute allowlist clears \`field-attributes-lost\` from **${cleared}**`,
    `definitions and unlocks **${unlocked}** of them outright. That is the number to plan`,
    'against, and it is small.',
    '',
    'The reason is not that the attributes are hard. It is that',
    '`field-attributes-lost` is almost never the *only* thing wrong with a',
    'definition: the definitions it blocks are mostly the same ones that need a',
    'repeat node, an icon sprite, or `INTERACTION_PRESET_CSS` modelled as a real',
    'dependency. Attributes are a prerequisite for those definitions rather than a',
    'release on their own.',
    '',
    'The case for doing it anyway is that it is cheap and it is on the critical',
    'path: none of the other work imports a single extra definition while a link',
    'still cannot carry the class that styles it. The case against doing more than',
    'the ranked lists above is that every further attribute costs a value grammar,',
    'a renderer branch and a database check, and buys zero definitions.',
    '',
    'The one change with a larger payoff than any of them is not an attribute at',
    'all. See "blocked by exactly one remaining thing" above.',
    '',
  )
  return lines
}

/** The value grammar an allowlist entry would need, in one clause. */
function grammarFor(name: string): string {
  if (name === 'class') return 'grammar: a space-separated list of `STRUCTURED_TOKEN`, as element nodes already use'
  if (name === 'width' || name === 'height') return 'grammar: a non-negative integer'
  if (name === 'rel') return 'grammar: a space-separated list from the HTML link-type keywords'
  return 'grammar: one keyword from a closed HTML set'
}

/** Why an attribute stays out, in one clause, keyed by the reason rather than by taste. */
function quarantineWhy(name: string): string {
  if (name === 'class') {
    // Not "class has no grammar" — it has the same one element nodes already
    // use. The value is what fails, and saying so is the difference between an
    // attribute nobody can validate and a definition written in a utility
    // framework the token grammar was never going to accept.
    return (
      'the value, not the attribute: a class list of framework utilities ' +
      '(`sm:` prefixes, bracketed arbitrary values) is not a list of `STRUCTURED_TOKEN`, ' +
      'and widening the token grammar to admit it would admit almost any string'
    )
  }
  if (name === 'style') {
    return (
      'an inline declaration list is a second CSS sink outside the one CSS policy, ' +
      'which is the hole `STRUCTURED_ATTRIBUTES` was drawn to close'
    )
  }
  if (/^on[a-z]+$/.test(name)) return 'executable content on an element, which no allowlist should reopen'
  if (name.startsWith('data-')) {
    return (
      'a behaviour hook whose meaning lives in V1 JavaScript that does not exist in v2, ' +
      'so there is nothing for the value to mean'
    )
  }
  return 'no closed value grammar, so nothing could validate it'
}
