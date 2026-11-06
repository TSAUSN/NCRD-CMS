// Which class names a stylesheet defines, and which ones a definition uses
// without defining.
//
// This is how the importer refuses the failure ADR 0007 names outright: a
// definition whose layout comes from INTERACTION_PRESET_CSS imports cleanly,
// renders without an error, and looks wrong. Markup that parses is not evidence
// of a successful import, and the class list is the evidence that is actually
// available.
//
// PostCSS rather than a regular expression, for the same reason css.ts uses it:
// a class name is an identifier in a selector, and `transition: color .2s` is
// not a rule about a class called `color`. Reading rule preludes through the
// parser the repository already trusts means there is no second idea here of
// what a selector is.

import postcss, { type AtRule, type Root, type Rule } from 'postcss'

/**
 * A class name in a selector: a dot, then an identifier.
 *
 * Applied only to selector text, never to a whole stylesheet. Escapes are not
 * resolved — a stylesheet that spells `fx-lift` as `f\78 -lift` is not something
 * V1's generated presets contain, and this list is used to *widen* what gets
 * quarantined rather than to decide anything is safe, so the conservative
 * failure is to miss a class and quarantine one definition too few, which the
 * per-definition checks then catch on their own terms.
 */
const CLASS_IN_SELECTOR = /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g

/** Every class name this stylesheet's selectors mention, unsorted, with repeats. */
export function classesInStylesheet(css: string): string[] {
  let root: Root
  try {
    root = postcss.parse(css)
  } catch {
    // A stylesheet this cannot parse tells us nothing about which classes it
    // defines. Returning nothing is the conservative answer here: the definition
    // is then judged to define no classes of its own, so anything it uses from
    // the preset sheet still quarantines it.
    return []
  }
  const found: string[] = []
  collect(root, found)
  return found
}

function collect(container: Root | AtRule, into: string[]): void {
  for (const node of container.nodes ?? []) {
    if (node.type === 'atrule') {
      collect(node as AtRule, into)
      continue
    }
    if (node.type !== 'rule') continue
    for (const match of (node as Rule).selector.matchAll(CLASS_IN_SELECTOR)) into.push(match[1]!)
  }
}

/** Every class name this markup puts on an element, in document order. */
export function classesInMarkup(classAttributes: readonly string[]): string[] {
  const out: string[] = []
  for (const value of classAttributes) {
    for (const token of value.split(/\s+/)) if (token !== '') out.push(token)
  }
  return out
}

/**
 * The classes a definition takes from a stylesheet that is not its own.
 *
 * A class counts as borrowed when the shared sheet defines it and the
 * definition's own sheet does not. A class both sheets define is not evidence of
 * a dependency — the definition carries its own rule for it — and counting those
 * would quarantine definitions over a name collision.
 */
export function borrowedClasses(input: {
  used: readonly string[]
  presetClasses: readonly string[]
  ownCss: readonly string[]
}): string[] {
  const preset = new Set(input.presetClasses)
  const own = new Set(input.ownCss)
  const borrowed = new Set<string>()
  for (const name of input.used) if (preset.has(name) && !own.has(name)) borrowed.add(name)
  return [...borrowed].sort((a, b) => a.localeCompare(b, 'en'))
}
