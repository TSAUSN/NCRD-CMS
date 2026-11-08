import type {
  AttributeSighting,
  FieldAttributeRow,
  DefinitionAttribution,
  FieldAttributeInventory,
  AllowlistStep,
} from './field-attributes.ts'
import {
  ATTRIBUTE_BINDINGS,
  ATTRIBUTE_EFFECTS,
  type AttributeVerdict,
  factFor,
  type FieldKind,
  ATTRIBUTE_VERDICTS,
} from './field-attribute-policy.ts'
import { type V1Definition } from './source.ts'

/** Every sighting, grouped into one row per field kind, attribute name and value shape. */
export function tabulate(sightings: readonly AttributeSighting[]): FieldAttributeRow[] {
  const groups = new Map<string, AttributeSighting[]>()
  for (const sighting of sightings) {
    const key = `${sighting.fieldKind}\u0000${sighting.name}\u0000${sighting.shape}`
    const list = groups.get(key) ?? []
    list.push(sighting)
    groups.set(key, list)
  }

  const rows = [...groups.values()].map((group): FieldAttributeRow => {
    const first = group[0]!
    const ids = [...new Set(group.map(s => s.definitionId))].sort((a, b) => a.localeCompare(b, 'en'))
    const bindings = [...new Set(group.map(s => s.binding))].sort(
      (a, b) => ATTRIBUTE_BINDINGS.indexOf(a) - ATTRIBUTE_BINDINGS.indexOf(b),
    )
    const effects = [...new Set(group.flatMap(s => s.effects))].sort(
      (a, b) => ATTRIBUTE_EFFECTS.indexOf(a) - ATTRIBUTE_EFFECTS.indexOf(b),
    )
    const inSelector = group.filter(s => s.inSelector).length
    return {
      fieldKind: first.fieldKind,
      name: first.name,
      shape: first.shape,
      occurrences: group.length,
      definitions: ids.length,
      definitionIds: ids,
      bindings,
      ownership: first.ownership,
      effects,
      anchorRole: first.anchorRole,
      consumedByField: first.consumedByField,
      inSelector,
      // `class` is excluded for the reason `verdictFor` gives: this importer
      // reads two stylesheets and the sites render with more, so a class no
      // selector here depends on is not a class nothing styles.
      wrapperSafe: first.name !== 'class' && first.ownership === 'wrapper-capable' && inSelector === 0,
      expressible: first.expressible,
      verdict: verdictFor(first),
    }
  })

  // Sorted so the report leads with what matters and never with a Map's
  // insertion order: field kind, then how many definitions carry it, then the
  // name and the shape to break every remaining tie.
  return rows.sort(
    (a, b) =>
      a.fieldKind.localeCompare(b.fieldKind, 'en') ||
      b.definitions - a.definitions ||
      b.occurrences - a.occurrences ||
      a.name.localeCompare(b.name, 'en') ||
      a.shape.localeCompare(b.shape, 'en'),
  )
}

/**
 * What to do with this attribute, from the evidence rather than from taste.
 *
 * An attribute the field node already carries needs nothing. One a wrapper could
 * hold without a stylesheet noticing is a wrapper's job, not a new field-node
 * feature. One with a closed value grammar and no policy hazard is a candidate
 * for the allowlist. Everything else stays quarantined, and the two hazards —
 * inline style and event handlers — stay quarantined even though their grammar
 * could be closed, because the reason schema v1 excluded them was never grammar.
 */
function verdictFor(sighting: AttributeSighting): AttributeVerdict {
  if (sighting.consumedByField) return 'support'
  const fact = factFor(sighting.name)
  if (fact.hazard === true) return 'quarantine'
  // A class is never given the `wrapper` verdict, however few selectors this
  // importer can see depending on it. It reads three stylesheets — the
  // definition's own, the shared preset sheet, and nothing else — and the sites
  // that render these definitions load global sheets it does not. So "no
  // selector depends on this class" is a statement about what was looked at,
  // and moving a class to a wrapper on the strength of it is the silent-layout-
  // loss failure ADR 0007 exists to refuse. The `in a selector` column still
  // reports what was measured.
  if (sighting.name === 'class') return sighting.expressible ? 'support' : 'quarantine'
  if (sighting.ownership === 'wrapper-capable' && !sighting.inSelector) return 'wrapper'
  return sighting.expressible ? 'support' : 'quarantine'
}

// ------------------------------------------------------- the per-definition view

export function attributions(
  definitions: readonly V1Definition[],
  codesById: ReadonlyMap<string, string[]>,
  statusById: ReadonlyMap<string, string>,
  lossesById: ReadonlyMap<string, AttributeSighting[]>,
): DefinitionAttribution[] {
  return definitions.map((definition): DefinitionAttribution => {
    const codes = codesById.get(definition.id) ?? []
    const losses = lossesById.get(definition.id) ?? []
    const lostOn = (kind: FieldKind): string[] =>
      [...new Set(losses.filter(loss => loss.fieldKind === kind).map(loss => loss.name))].sort((a, b) =>
        a.localeCompare(b, 'en'),
      )
    const fieldAttributesLost = codes.includes('field-attributes-lost')
    const clearable = losses.length > 0 && losses.every(loss => loss.expressible)
    return {
      id: definition.id,
      status: statusById.get(definition.id) ?? 'unknown',
      reasonCodes: codes,
      fieldAttributesLost,
      unsupportedAttribute: codes.includes('unsupported-attribute'),
      lostOnLink: lostOn('link'),
      lostOnImage: lostOn('image'),
      lostButNotCoded: losses.length > 0 && !fieldAttributesLost,
      clearableByAllowlist: clearable,
      remainingCodes: codes
        .filter(code => code !== 'field-attributes-lost')
        .filter((code, at, all) => all.indexOf(code) === at)
        .sort((a, b) => a.localeCompare(b, 'en')),
    }
  })
}

export function countInventory(
  definitions: readonly V1Definition[],
  attributions: readonly DefinitionAttribution[],
  lossesById: ReadonlyMap<string, AttributeSighting[]>,
  shape: { linkFieldElements: number; imageFieldElements: number; withLink: number; withImage: number },
): FieldAttributeInventory['counts'] {
  const both = attributions.filter(row => row.fieldAttributesLost && row.unsupportedAttribute).length
  return {
    definitions: definitions.length,
    definitionsWithLinkField: shape.withLink,
    definitionsWithImageField: shape.withImage,
    linkFieldElements: shape.linkFieldElements,
    imageFieldElements: shape.imageFieldElements,
    definitionsWithLoss: lossesById.size,
    fieldAttributesLostCode: attributions.filter(row => row.fieldAttributesLost).length,
    unsupportedAttributeCode: attributions.filter(row => row.unsupportedAttribute).length,
    bothCodes: both,
    eitherCode: attributions.filter(row => row.fieldAttributesLost || row.unsupportedAttribute).length,
    lostButNotCoded: attributions.filter(row => row.lostButNotCoded).length,
  }
}

// ------------------------------------------------------------- the allowlist

/**
 * The smallest allowlist that clears the most definitions.
 *
 * Greedy over *bundles* rather than over names, for the reason `AllowlistStep`
 * gives. The candidate bundles are the distinct sets of attributes that
 * individual definitions would lose — nothing invented, only sets the catalogue
 * actually asks for.
 *
 * The step chosen is the one with the best *marginal density*: definitions
 * cleared per attribute added. Choosing the bundle that simply clears the most
 * produced a single step for each field kind — `class + rel + target` clearing
 * 61 — which is the correct maximum and a useless recommendation, because it
 * hides that `class` alone reaches 60 and the other two attributes buy one
 * definition between them. Density recovers the shape somebody would actually
 * implement in order, and the endpoint is unchanged: the walk continues until no
 * bundle clears anything further.
 *
 * Definitions with a loss no grammar can express are excluded from the
 * candidates: an allowlist cannot clear them at any size, and letting their sets
 * seed a bundle would put `style` in an allowlist that buys nothing.
 */
export function rankAllowlist(
  lossesById: ReadonlyMap<string, AttributeSighting[]>,
  attributions: readonly DefinitionAttribution[],
): FieldAttributeInventory['allowlist'] {
  const remaining = new Map(attributions.map(row => [row.id, row.remainingCodes]))
  // A step's verdict is taken over the occurrences the allowlist would actually
  // accept, which means the expressible ones. Taking it over every occurrence
  // instead reported the whole `class` bundle as `quarantine` on the strength of
  // one definition writing Tailwind utilities — a definition the allowlist never
  // clears anyway, because it is in `unclearable`. A price is only a price for
  // something you are buying.
  const verdicts = new Map<string, AttributeVerdict>()
  const record = (loss: AttributeSighting): void => {
    const verdict = verdictFor(loss)
    const seen = verdicts.get(loss.name)
    if (seen === undefined || rankVerdict(verdict) > rankVerdict(seen)) verdicts.set(loss.name, verdict)
  }
  for (const losses of lossesById.values()) for (const loss of losses) if (loss.expressible) record(loss)
  // Names with no expressible occurrence at all still need a verdict, for the
  // case where a future catalogue puts one inside a bundle.
  for (const losses of lossesById.values()) {
    for (const loss of losses) if (!verdicts.has(loss.name)) record(loss)
  }

  const stepsFor = (kind: FieldKind | 'both'): AllowlistStep[] => {
    const relevant = [...lossesById]
      .map(([id, losses]) => ({
        id,
        losses: kind === 'both' ? losses : losses.filter(loss => loss.fieldKind === kind),
      }))
      .filter(entry => entry.losses.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id, 'en'))

    const required = new Map<string, string[]>()
    for (const entry of relevant) {
      // Only definitions every one of whose losses has a grammar. The others are
      // in `unclearable`, counted and named, rather than silently absent.
      if (!entry.losses.every(loss => loss.expressible)) continue
      required.set(
        entry.id,
        [...new Set(entry.losses.map(loss => loss.name))].sort((a, b) => a.localeCompare(b, 'en')),
      )
    }
    const bundles = [...new Set([...required.values()].map(names => names.join(' ')))]
      .sort((a, b) => a.localeCompare(b, 'en'))
      .map(key => (key === '' ? [] : key.split(' ')))

    const cleared = (allowed: ReadonlySet<string>): string[] =>
      [...required].filter(([, names]) => names.every(name => allowed.has(name))).map(([id]) => id)

    const allowed = new Set<string>()
    const steps: AllowlistStep[] = []
    let previous = 0
    for (;;) {
      let best: { added: string[]; count: number; gain: number } | null = null
      for (const bundle of bundles) {
        const added = bundle.filter(name => !allowed.has(name)).sort((a, b) => a.localeCompare(b, 'en'))
        if (added.length === 0) continue
        const count = cleared(new Set([...allowed, ...bundle])).length
        const candidate = { added, count, gain: count - previous }
        if (candidate.gain <= 0) continue
        if (best === null || better(candidate, best)) best = candidate
      }
      if (best === null) break
      for (const name of best.added) allowed.add(name)
      const nowCleared = cleared(allowed)
      steps.push({
        rank: steps.length + 1,
        fieldKind: kind,
        added: best.added,
        allowlist: [...allowed].sort((a, b) => a.localeCompare(b, 'en')),
        newlyCleared: nowCleared.length - previous,
        cumulativeCleared: nowCleared.length,
        cumulativeUnlocked: nowCleared.filter(id => (remaining.get(id) ?? []).length === 0).length,
        verdict: best.added
          .map(name => verdicts.get(name) ?? 'quarantine')
          .reduce((worst, next) => (rankVerdict(next) > rankVerdict(worst) ? next : worst), 'support'),
      })
      previous = nowCleared.length
    }
    return steps
  }

  const unclearable = [...lossesById]
    .filter(([, losses]) => losses.some(loss => !loss.expressible))
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b, 'en'))

  return { link: stepsFor('link'), image: stepsFor('image'), combined: stepsFor('both'), unclearable }
}

/**
 * Is this candidate step a better buy than the best so far?
 *
 * Density first — definitions cleared per attribute added — compared as
 * `a.gain * b.names > b.gain * a.names` rather than as a division, so no
 * platform's floating point gets a say in which step a report lists first. Then
 * the cheaper bundle, then the one clearing more, then the alphabetically first,
 * which between them leave no tie for the catalogue's read order to break.
 */
function better(
  candidate: { added: string[]; count: number; gain: number },
  best: { added: string[]; count: number; gain: number },
): boolean {
  const left = candidate.gain * best.added.length
  const right = best.gain * candidate.added.length
  if (left !== right) return left > right
  if (candidate.added.length !== best.added.length) return candidate.added.length < best.added.length
  if (candidate.count !== best.count) return candidate.count > best.count
  return candidate.added.join(' ').localeCompare(best.added.join(' '), 'en') < 0
}

/** How unacceptable a verdict is, so the worst of a set can be taken. */
function rankVerdict(verdict: AttributeVerdict): number {
  return ATTRIBUTE_VERDICTS.indexOf(verdict)
}

/**
 * Definitions blocked by exactly one remaining thing, by what that thing is.
 *
 * Asked only of definitions a full attribute allowlist would clear, because for
 * every other definition the attribute question is not the last question and the
 * count would be a different, less useful one.
 */
export function rankRemaining(attributions: readonly DefinitionAttribution[]): { code: string; definitions: number }[] {
  const tally = new Map<string, number>()
  for (const row of attributions) {
    if (!row.clearableByAllowlist) continue
    if (row.remainingCodes.length !== 1) continue
    const code = row.remainingCodes[0]!
    tally.set(code, (tally.get(code) ?? 0) + 1)
  }
  return [...tally]
    .map(([code, definitions]) => ({ code, definitions }))
    .sort((a, b) => b.definitions - a.definitions || a.code.localeCompare(b.code, 'en'))
}
