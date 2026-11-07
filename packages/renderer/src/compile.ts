// Section definitions are compiled once, at authoring time, into a checked AST
//. Public rendering consumes the AST; it never reparses authored
// markup on a request. The source is kept for editing and audit only.
//
// Policy version 2 changed both the AST shape and the rendering contract: every
// slot now carries the *sink* it lands in, and each sink has its own escaper.
// Version 1 recorded no context at all, so the renderer had to guess, and it
// guessed "element text" — the wrong escaper for an attribute, a URL and a
// style value, and no escaper at all for a tag name. See context.ts.
import { sha256Hex } from './sha256.ts'
import {
  isSectionSlug,
  siteWidget,
  repeatTemplateSpec as repeatItemSpec,
  collectionTemplateSpec,
  SLOT_ID,
  SLOT_KINDS,
  type SlotDef,
} from '@cms/schema'
import { CSS_POLICY_VERSION, scopeCss } from './css.ts'
import {
  CONTEXT_REFUSALS,
  isKnownContext,
  isSafeContext,
  opensScriptElement,
  scanSlotSites,
  type SlotContext,
} from './context.ts'

export const SANITIZER_POLICY_VERSION = 4
/** Additive contract for typed scalar attributes; unchanged templates stay v4. */
export const TYPED_ATTRIBUTE_POLICY_VERSION = 5

export type AstNode =
  | { kind: 'html'; value: string }
  | {
      kind: 'slot'
      slotId: string
      slotKind: SlotDef['kind']
      /** The sink this value lands in. Decided here, obeyed by the renderer. */
      context: SlotContext
      /** The attribute it lands in, when it lands in one. For diagnostics. */
      attribute?: string
      /**
       * On a `repeat` slot only: this node opens (`{{#id}}`) or closes
       * (`{{/id}}`) the markup drawn once per item (LIB-02). The slots between
       * the two are the item's own fields, by their ids within the item.
       */
      marker?: 'start' | 'end'
    }

export type CompiledSection = {
  nodes: AstNode[]
  policyVersion: number
  cssPolicyVersion: number
}

export type CompileResult = {
  ast: CompiledSection
  css: string
  renderHash: string
  /** Raw markup an author pasted is trusted code; only a super admin publishes it. */
  carriesTrustedCode: boolean
  problems: string[]
  /**
   * Problems that make the definition unsafe rather than merely wrong.
   *
   * Not the same thing as trusted code, and not approvable. A super admin can
   * decide to accept an `<iframe>` an author pasted; nobody can decide that an
   * unquoted attribute value is escapable, because it is not — a space ends it.
   * The authoring command refuses to store a definition with blocking problems
   * and the renderer refuses to render one, so neither surface depends on the
   * other having remembered.
   */
  blocking: string[]
}

/**
 * The scope every section definition's CSS is compiled under.
 *
 * Named rather than defaulted in three places, because revalidation has to
 * reproduce an earlier compilation exactly, and a default that two callers
 * agree on by coincidence is not a guarantee.
 */
export const SECTION_SCOPE_SELECTOR = '.cms-section'

/**
 * The scope a definition's CSS is compiled under, derived from its slug.
 *
 * `.cms-section--hero` rather than `.cms-section`, matching the class the
 * renderer puts on the element, so one definition's stylesheet cannot restyle a
 * different definition's sections. Derived in one function because four
 * separate places need the same answer — the compiler, the seed, revalidation,
 * and the validator that checks a stored artifact — and three of them agreeing
 * by coincidence is not a rule.
 */
export function sectionScopeSelector(slug: string | null | undefined): string | null {
  // No slug, no scope. Falling back to the bare `.cms-section` scoped a
  // definition's stylesheet to *every* section on the page, which is the
  // failure this function exists to prevent, arrived at by a different route.
  // A slug that is not a slug does not become a scope. It used to become
  // selector syntax: `a,body` produced `.cms-section--a,body`, a selector list
  // whose second branch restyles the document, and `.`, `#`, `[`, `>`, a space
  // and a backslash were all equally available.
  return isSectionSlug(slug) ? `${SECTION_SCOPE_SELECTOR}--${slug}` : null
}

/** Slot kinds that emit markup, and therefore only belong between tags. */
const MARKUP_KINDS = new Set(['richtext', 'link', 'button', 'image', 'navigation'])

/** Fixed scalar projections only; never a user-selected property or sink. */
export function isTypedAttributeBinding(kind: string, context: SlotContext, attribute?: string): boolean {
  return (
    (kind === 'image' &&
      ((context === 'url-attribute' && attribute === 'src') ||
        (context === 'quoted-attribute' && (attribute === 'alt' || attribute === 'role')))) ||
    ((kind === 'link' || kind === 'button') && context === 'url-attribute' && attribute === 'href')
  )
}

const KNOWN_SLOT_KINDS = new Set<string>(SLOT_KINDS)

/**
 * The marker a slot is replaced by when the template is reconstructed.
 *
 * Generated from the slot's *position*, never from its stored id. Interpolating
 * the id was the bug: an id of `a}}</p><div title="` closed its own marker and
 * fed the tokenizer markup that changed where every later slot appeared to sit,
 * so a slot genuinely inside `<div ` was re-derived as a quoted attribute and
 * escaped accordingly — which is to say, not escaped for the place it was.
 *
 * The form matters too. `__cms_slot_N__` is itself a valid slot id, so a
 * genuinely compiled AST can never carry one inside an html node: the compiler
 * would have turned it into a slot node. Finding one there means somebody wrote
 * it by hand.
 */
const sentinelFor = (index: number): string => `__cms_slot_${index}__`

/** Where each repeat's item markup lies, as [start marker, end marker] node indexes. */
export function repeatRanges(nodes: readonly AstNode[]): Map<string, [number, number]> {
  const ranges = new Map<string, [number, number]>()
  let start = -1
  nodes.forEach((node, at) => {
    if (node.kind !== 'slot' || !node.marker) return
    if (node.marker === 'start') start = at
    else if (start >= 0) {
      ranges.set(node.slotId, [start, at])
      start = -1
    }
  })
  return ranges
}

function insideAny(ranges: Map<string, [number, number]>, at: number): boolean {
  for (const [from, to] of ranges.values()) if (at > from && at < to) return true
  return false
}

/**
 * A script-bearing template cannot contain editable slots. Approval permits the static script, but
 * must not make authored field values executable. Rejecting the combination structurally keeps the
 * rule independent of script position and escaping.
 */
export const SCRIPT_AND_SLOTS =
  'this template contains a script element, so it cannot also contain editable slots — ' +
  'raw code goes through the approval path as static markup, without slots'
const SENTINEL_IN_HTML = /\{\{\s*__cms_slot_\d+__\s*\}\}/

const TOKEN = /\{\{\s*([#/]?)([\w-]+)\s*\}\}/g
// `[\s/]`, not `\s`. HTML accepts a solidus wherever it accepts whitespace
// between attributes, so `<img/onerror=alert(1) src=x>` is an image with an
// error handler — and this regex, which decides whether a template needs
// super-admin approval, said it carried no active markup at all. That answer
// becomes `carries_trusted_code` in the publish gate, so the template shipped
// with no review. Chromium normalises it back to `<img onerror="…" src="x">`
// and fires it.
// `vbscript:` is here because the CSS policy already refuses it and this gate
// did not, so the same scheme was active markup in a stylesheet and unremarkable
// in a template. Static markup is emitted verbatim — it never passes through
// safeUrl — so `<a href="vbscript:…">` in a definition shipped with no review.
//
// `style` is here for the same reason from the other direction: the CSS policy
// runs on a definition's `sourceCss`, and a `<style>` element inside the
// *template* is markup, so it shipped whatever it liked — `url(//evil.test/x)`
// included — with neither the policy nor a reviewer ever seeing it. It is a
// stylesheet a person should look at, which is what this flag means.
const ACTIVE_MARKUP =
  /<\s*(script|iframe|object|embed|form|link|meta|base|style)\b|[\s/]on[a-z]+[\s/]*=|(javascript|vbscript)\s*:/i

/**
 * Compile source HTML + CSS + slot declarations.
 *
 * Every slot is classified by an HTML tokenizer walk of the template, and a
 * slot in a position that cannot be escaped safely is blocking rather than a
 * warning.
 */
/**
 * The script-and-slots rule, asked of a node list rather than of a template.
 *
 * Both the compiler and the rebinder ask it of the same thing — the markup the
 * AST actually carries — so the two cannot disagree, and neither can disagree
 * with `app.render_ast_defect`, which concatenates exactly these values.
 */
function mixesScriptAndSlots(nodes: readonly AstNode[]): boolean {
  if (!nodes.some(node => node.kind === 'slot')) return false
  return opensScriptElement(nodes.map(node => (node.kind === 'html' ? node.value : '')).join(''))
}

export function compileSection(input: {
  sourceHtml: string
  sourceCss?: string
  slots: readonly SlotDef[]
  scopeSelector?: string
}): CompileResult {
  const problems: string[] = []
  const blocking: string[] = []
  const slotsById = new Map(input.slots.map(slot => [slot.id, slot]))
  const nodes: AstNode[] = []
  // Uses per scope: the section's own fields, and each repeat's item fields.
  const scopes = new Map<string, { slots: readonly SlotDef[]; seen: Set<string> }>([
    ['', { slots: input.slots, seen: new Set() }],
  ])
  let open: { id: string; fields: Map<string, SlotDef> } | null = null

  const siteAt = new Map(scanSlotSites(input.sourceHtml).map(site => [site.index, site]))

  let cursor = 0
  for (const match of input.sourceHtml.matchAll(TOKEN)) {
    const index = match.index
    if (index > cursor) nodes.push({ kind: 'html', value: input.sourceHtml.slice(cursor, index) })
    cursor = index + match[0].length

    const marker = match[1] === '#' ? ('start' as const) : match[1] === '/' ? ('end' as const) : undefined
    const slotId = match[2]!
    if (!SLOT_ID.test(slotId)) {
      blocking.push(`{{${match[1]}${slotId}}} is not a usable slot id`)
      continue
    }
    // The tokenizer walk and this token scan agree on offsets; a slot the walk
    // did not reach is one it could not classify, which is unsafe by default.
    const site = siteAt.get(index)
    const context: SlotContext = site?.context ?? 'unknown'

    if (marker) {
      // A repeated item's markup is drawn once per item, so it must start and
      // end between tags: then every copy is read exactly as the first one was.
      const slot = slotsById.get(slotId)
      const spec = slot ? repeatItemSpec(slot) : null
      if (slot?.constraints?.collection === true && !collectionTemplateSpec(slot))
        blocking.push('List items need declared text, rich text, picture or link fields.')
      if (!slot || !spec) {
        problems.push(
          `the template uses {{${match[1]}${slotId}}} but no repeated field with that id declares its items`,
        )
        continue
      }
      if (context !== 'element-text') {
        blocking.push(`{{${match[1]}${slotId}}} must sit between tags, where an item's markup can be repeated`)
        continue
      }
      if (marker === 'start') {
        if (open) {
          blocking.push(`{{#${slotId}}} opens inside {{#${open.id}}}; repeated items cannot be nested`)
          continue
        }
        if (scopes.has(slotId)) {
          blocking.push(`{{#${slotId}}} is used more than once`)
          continue
        }
        open = { id: slotId, fields: new Map(spec.fields.map(field => [field.id, field])) }
        scopes.set(slotId, { slots: spec.fields, seen: new Set() })
      } else {
        if (open?.id !== slotId) {
          blocking.push(`{{/${slotId}}} closes an item that is not open`)
          continue
        }
        open = null
      }
      scopes.get('')!.seen.add(slotId)
      nodes.push({ kind: 'slot', slotId, slotKind: 'repeat', context, marker })
      continue
    }

    // Inside an item, a token names one of the item's own fields.
    const slot = open ? open.fields.get(slotId) : slotsById.get(slotId)
    if (!slot) {
      problems.push(
        open
          ? `inside {{#${open.id}}}, {{${slotId}}} is not one of the item's fields`
          : `the template uses {{${slotId}}} but no slot with that id is declared`,
      )
      continue
    }
    if (!KNOWN_SLOT_KINDS.has(slot.kind)) {
      blocking.push(`slot ${slotId} has kind ${JSON.stringify(slot.kind)}, which this renderer cannot fill`)
      continue
    }
    scopes.get(open ? open.id : '')!.seen.add(slotId)

    if (!isSafeContext(context)) {
      blocking.push(`slot ${slotId} ${CONTEXT_REFUSALS[context as keyof typeof CONTEXT_REFUSALS]}`)
    } else if (
      (MARKUP_KINDS.has(slot.kind) || siteWidget(slot)) &&
      context !== 'element-text' &&
      !isTypedAttributeBinding(slot.kind, context, site?.attribute)
    ) {
      // A rich text, link, or image slot emits markup. Markup inside an
      // attribute is not a rendering problem to solve with more escaping — it
      // is a template that cannot mean what its author intended.
      blocking.push(`slot ${slotId} is a ${slot.kind} slot but sits inside an attribute, where markup cannot go`)
    }

    nodes.push({
      kind: 'slot',
      slotId,
      slotKind: slot.kind,
      context,
      ...(site?.attribute === undefined ? {} : { attribute: site.attribute }),
    })
  }
  if (cursor < input.sourceHtml.length) {
    nodes.push({ kind: 'html', value: input.sourceHtml.slice(cursor) })
  }
  if (open) blocking.push(`{{#${open.id}}} is never closed`)

  // Each scope's fields are used once (a picture's src, alt and role are one
  // field), and every declared field is used.
  const ranges = repeatRanges(nodes)
  for (const [scope, { slots, seen }] of scopes) {
    const range = scope === '' ? null : ranges.get(scope)
    for (const slot of slots) {
      const uses = nodes.filter(
        (node, at): node is Extract<AstNode, { kind: 'slot' }> =>
          node.kind === 'slot' &&
          !node.marker &&
          node.slotId === slot.id &&
          (range ? at > range[0] && at < range[1] : !insideAny(ranges, at)),
      )
      // The src, alt and role of one preserved image are one editor field. A
      // navigation slot has no stored value, so a desktop row and a phone menu
      // may both place the same site menu (ADR 0010).
      if (
        uses.length > 1 &&
        slot.kind !== 'navigation' &&
        !uses.every(node => isTypedAttributeBinding(node.slotKind, node.context, node.attribute))
      ) {
        problems.push(`slot ${slot.id} is used more than once`)
      }
      if (!seen.has(slot.id)) {
        const message = `slot ${slot.id} is declared but never used in the template`
        problems.push(message)
        if (scope && slotsById.get(scope)?.constraints?.collection === true) blocking.push(message)
      }
    }
  }

  for (const slot of input.slots) {
    if (!SLOT_ID.test(slot.id)) {
      blocking.push(`${JSON.stringify(slot.id)} is not a usable slot id`)
    }
  }

  const carriesTrustedCode = ACTIVE_MARKUP.test(input.sourceHtml)
  if (carriesTrustedCode) {
    problems.push('the template contains active markup, so publishing it needs super-admin approval')
  }

  // A template with a script element may not have slots in it — anywhere, not
  // just inside the script. See SCRIPT_AND_SLOTS below for why this is a rule
  // about the template rather than about the slot's position.
  if (mixesScriptAndSlots(nodes)) blocking.push(SCRIPT_AND_SLOTS)

  const scoped = scopeCss(input.sourceCss ?? '', input.scopeSelector ?? SECTION_SCOPE_SELECTOR)
  problems.push(...scoped.violations)
  blocking.push(...scoped.blocking)

  const ast: CompiledSection = {
    nodes,
    policyVersion: nodes.some(
      node => node.kind === 'slot' && isTypedAttributeBinding(node.slotKind, node.context, node.attribute),
    )
      ? TYPED_ATTRIBUTE_POLICY_VERSION
      : SANITIZER_POLICY_VERSION,
    cssPolicyVersion: CSS_POLICY_VERSION,
  }

  return {
    ast,
    css: scoped.css,
    // Identifies exactly what would render: the golden tests compare this
    // before comparing output, so a definition change is never invisible.
    renderHash: sha256Hex(JSON.stringify({ ast, css: scoped.css })).slice(0, 32),
    carriesTrustedCode,
    problems: [...problems, ...blocking],
    blocking,
  }
}

// ------------------------------------------------------- stored definitions

export type UpgradeResult = {
  ast: CompiledSection
  /** True when the stored AST was already at the current policy version. */
  current: boolean
  /** Slots that cannot be rendered safely once re-classified. */
  blocking: string[]
}

/**
 * Bring a stored AST up to the current policy version, or refuse it.
 *
 * The template is reconstructed from the stored nodes and re-scanned by the
 * same tokenizer, so the result is derived from what was actually saved rather
 * than guessed at. Valid visible text is unchanged by construction: a version-1
 * slot that turns out to sit in element text renders exactly as it did. A
 * version-1 slot that turns out to sit somewhere unsafe becomes blocking, which
 * is the point of the bump — it is reported, not quietly reinterpreted.
 *
 * `source_html` is stored alongside every version, so the authoritative repair
 * is to recompile from source; `pnpm db:revalidate` does that and reports what
 * it found. This function exists for the renderer's own safety, because it must
 * fail closed on an AST it did not produce — including one hand-built, carried
 * over from policy version 1, or corrupted in the database.
 */
export function upgradeCompiledSection(stored: unknown): UpgradeResult {
  const empty: CompiledSection = {
    nodes: [],
    policyVersion: SANITIZER_POLICY_VERSION,
    cssPolicyVersion: CSS_POLICY_VERSION,
  }
  if (!isCompiledSection(stored)) {
    return { ast: empty, current: false, blocking: ['the stored render AST is not a compiled section'] }
  }

  // No fast path for a current-version AST, and that is the point.
  //
  // The previous version trusted any node list whose slots merely *had* a
  // context string, which made the context a claim the AST got to make about
  // itself. A hand-written row could put `context: 'element-text'` on a slot
  // sitting in `<div {{value}}>` and the renderer would escape it as text —
  // which is to say, not escape the quotes or the spaces — and emit an
  // attacker's `onclick`. A stored value is data; it is never evidence about
  // itself. So the structure is rebound every time, from the nodes themselves.
  const bound = bindContexts(stored.nodes)
  const hasTypedAttributes = bound.nodes.some(
    node => node.kind === 'slot' && isTypedAttributeBinding(node.slotKind, node.context, node.attribute),
  )
  if (hasTypedAttributes && stored.policyVersion !== TYPED_ATTRIBUTE_POLICY_VERSION) {
    bound.blocking.push('typed attribute bindings require sanitizer policy version 5')
  }
  if (stored.policyVersion > TYPED_ATTRIBUTE_POLICY_VERSION) {
    bound.blocking.push('the stored render AST names an unknown future sanitizer policy')
  }
  const policyVersion = hasTypedAttributes ? TYPED_ATTRIBUTE_POLICY_VERSION : SANITIZER_POLICY_VERSION
  return {
    ast: {
      nodes: bound.nodes,
      policyVersion,
      cssPolicyVersion: stored.cssPolicyVersion ?? 0,
    },
    current: stored.policyVersion === policyVersion && bound.blocking.length === 0 && bound.rebound === 0,
    blocking: bound.blocking,
  }
}

export type BindResult = { nodes: AstNode[]; blocking: string[]; rebound: number }

/**
 * Derive every slot's context from the node list itself, and check it against
 * what the node claims.
 *
 * The node list *is* the template: concatenating it back together and running
 * the tokenizer over the result recovers exactly the positions the compiler saw.
 * Two details do the real work.
 *
 * Pairing is **positional**, not by slot id. Keying a lookup by id let two uses
 * of the same slot collapse into one entry, so a template with `{{x}}` once in a
 * paragraph and once in a bare attribute position took whichever the map
 * happened to keep — and the safe one overwriting the unsafe one is the wrong
 * way round to be wrong.
 *
 * And the reconstructed offsets are **checked**, not assumed. An html node whose
 * text happens to contain `{{something}}` would otherwise introduce a site the
 * compiler never emitted and shift every pairing after it by one.
 */
export function bindContexts(nodes: readonly AstNode[]): BindResult {
  const blocking: string[] = []

  // Nothing about a stored node is taken on faith, starting with its id.
  for (const node of nodes) {
    if (node.kind === 'html') {
      if (SENTINEL_IN_HTML.test(node.value)) {
        return {
          nodes: [],
          rebound: 0,
          blocking: ['the stored render AST contains a marker no compiler emits'],
        }
      }
      continue
    }
    if (typeof node.slotId !== 'string' || !SLOT_ID.test(node.slotId)) {
      blocking.push(`${JSON.stringify(node.slotId)} is not a usable slot id`)
    }
    if (!KNOWN_SLOT_KINDS.has(node.slotKind)) {
      blocking.push(`slot ${node.slotId} has kind ${JSON.stringify(node.slotKind)}, which this renderer cannot fill`)
    }
    const marker = (node as { marker?: unknown }).marker
    if (marker !== undefined && (node.slotKind !== 'repeat' || (marker !== 'start' && marker !== 'end'))) {
      blocking.push(`slot ${node.slotId} carries a repeat marker it cannot have`)
    }
  }
  // Repeated items open and close in pairs, one level deep, each once.
  let openRepeat: string | null = null
  const opened = new Set<string>()
  for (const node of nodes) {
    if (node.kind !== 'slot' || node.marker === undefined) continue
    if (node.marker === 'start') {
      if (openRepeat !== null || opened.has(node.slotId)) blocking.push(`repeat ${node.slotId} opens where it cannot`)
      openRepeat = node.slotId
      opened.add(node.slotId)
    } else {
      if (openRepeat !== node.slotId) blocking.push(`repeat ${node.slotId} closes where it was not open`)
      openRepeat = null
    }
  }
  if (openRepeat !== null) blocking.push(`repeat ${openRepeat} is never closed`)
  if (blocking.length > 0) return { nodes: [], rebound: 0, blocking: [...new Set(blocking)] }

  // Reconstructed with generated markers, so a stored id is never syntax.
  let template = ''
  const expected: { offset: number; sentinel: string }[] = []
  let index = 0
  for (const node of nodes) {
    if (node.kind === 'html') {
      template += node.value
      continue
    }
    const sentinel = sentinelFor(index)
    expected.push({ offset: template.length, sentinel })
    template += `{{${sentinel}}}`
    index += 1
  }

  const sites = scanSlotSites(template)
  const mismatched =
    sites.length !== expected.length ||
    expected.some(({ offset, sentinel }, i) => {
      const site = sites[i]
      // Count, position, identity and length, all four. Position alone was not
      // enough: a marker that closes itself can land a later one at the offset
      // the walk expected while meaning something entirely different.
      return (
        site === undefined || site.index !== offset || site.slotId !== sentinel || site.length !== sentinel.length + 4
      )
    })
  if (mismatched) {
    return {
      nodes: [],
      rebound: 0,
      blocking: ['the stored render AST does not describe the template it was compiled from'],
    }
  }

  let rebound = 0
  let slotIndex = 0
  const out: AstNode[] = nodes.map(node => {
    if (node.kind === 'html') return node
    const site = sites[slotIndex]!
    slotIndex += 1
    const derived: SlotContext = site.context
    const declared = (node as { context?: unknown }).context
    const declaredAttribute = (node as { attribute?: unknown }).attribute

    if (declared === undefined) {
      // A node from before contexts were recorded. Adopting the derived value
      // is a re-derivation, not a reinterpretation: it is what the compiler
      // would have written had it been asked at the time.
      rebound += 1
    } else if (!isKnownContext(declared)) {
      blocking.push(`slot ${node.slotId} names ${JSON.stringify(declared)}, which is not a context`)
    } else if (declared !== derived) {
      blocking.push(`slot ${node.slotId} claims to sit in ${declared} but sits in ${derived}`)
    } else if (
      site.attribute !== undefined &&
      declaredAttribute !== undefined &&
      declaredAttribute !== site.attribute
    ) {
      blocking.push(
        `slot ${node.slotId} claims the ${String(declaredAttribute)} attribute but sits in ${site.attribute}`,
      )
    }

    if (!isSafeContext(derived)) {
      blocking.push(`slot ${node.slotId} ${CONTEXT_REFUSALS[derived as keyof typeof CONTEXT_REFUSALS]}`)
    } else if (
      MARKUP_KINDS.has(node.slotKind) &&
      derived !== 'element-text' &&
      !isTypedAttributeBinding(node.slotKind, derived, site.attribute)
    ) {
      blocking.push(`slot ${node.slotId} is a ${node.slotKind} slot but sits inside an attribute`)
    } else if (node.marker !== undefined && derived !== 'element-text') {
      // Repeating markup that starts or ends inside a tag would change how
      // every later copy is read.
      blocking.push(`repeat ${node.slotId} does not start and end between tags`)
    }

    return {
      kind: 'slot',
      slotId: node.slotId,
      slotKind: node.slotKind,
      context: derived,
      ...(site.attribute === undefined ? {} : { attribute: site.attribute }),
      ...(node.marker === undefined ? {} : { marker: node.marker }),
    }
  })

  // The same rule the compiler applies, re-applied to what was stored.
  if (mixesScriptAndSlots(nodes)) blocking.push(SCRIPT_AND_SLOTS)

  return { nodes: out, blocking: [...new Set(blocking)], rebound }
}

function isCompiledSection(value: unknown): value is CompiledSection {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { nodes?: unknown }
  if (!Array.isArray(candidate.nodes)) return false
  return candidate.nodes.every(node => {
    if (typeof node !== 'object' || node === null) return false
    const n = node as { kind?: unknown; value?: unknown; slotId?: unknown; slotKind?: unknown }
    if (n.kind === 'html') return typeof n.value === 'string'
    return n.kind === 'slot' && typeof n.slotId === 'string' && typeof n.slotKind === 'string'
  })
}
