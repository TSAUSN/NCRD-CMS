// Why a definition did not become a structured section, in a vocabulary that is
// closed and machine-readable.
//
// Every refusal in this package names one of these codes, and every code has one
// sentence a person can read. Two forms rather than one, because the two have
// different readers: a spreadsheet counting `icon-field` wants a stable token
// that never gets reworded, and somebody asking "why is this section not on the
// site yet" wants a sentence. A free-text-only reason makes the first
// impossible; a code-only reason makes the second a lookup nobody performs.
//
// The codes also carry the *disposition* — quarantine or manual decision — so
// that "which bucket is this definition in" is a property of the reason rather
// than a second table somewhere that can disagree with it.

/**
 * What a reason does to a definition.
 *
 * `quarantine` means the current converter cannot carry this faithfully. The
 * model may already have a governed feature that needs a reviewed mapping or
 * instance data this catalogue does not provide. `manual-decision` is a
 * statement about the catalogue: the model could express it, but a question has
 * to be settled first that is not an importer's to settle — which of three
 * sites' markup is the definition, or what an anchor that points at nothing was
 * meant to reach.
 *
 * Keeping them apart matters for the number at the end. A definition held up by
 * a decision is work somebody can do this week; a quarantined one is work that
 * needs a faithful icon mapping, collection binding, or governed interaction.
 */
export type ReasonDisposition = 'quarantine' | 'manual-decision'

export type ReasonDef = {
  code: string
  disposition: ReasonDisposition
  /** A whole sentence, in the present tense, about this definition. */
  sentence: string
}

/**
 * `detail` is the part that varies per definition — a tag name, an attribute, a
 * slot id — and it is deliberately separate from the sentence so that grouping
 * by `code` still works when the details differ.
 */
export type Reason = ReasonDef & { detail?: string }

const REASON_LIST: ReasonDef[] = [
  // ------------------------------------------------- the vocabulary is missing
  {
    code: 'icon-field',
    disposition: 'quarantine',
    sentence:
      'It has an icon slot whose authored markup has no verified mapping to ' +
      'V2’s closed, code-owned icon names; substituting a similar icon would ' +
      'change its appearance rather than preserve it.',
  },
  {
    code: 'repeat-family',
    disposition: 'quarantine',
    sentence:
      'Its repeated unit is hand-flattened into a numbered slot family, and ' +
      'the catalogue does not establish an equivalent item template, collection ' +
      'schema and instance binding for V2’s repeat node. Numbered names alone ' +
      'are not proof that units can be merged without losing content or layout.',
  },
  {
    code: 'button-element',
    disposition: 'quarantine',
    sentence:
      'It contains a button whose action is not represented by this catalogue ' +
      'converter; re-typing it as a link would change its element and behavior.',
  },
  {
    code: 'form-element',
    disposition: 'quarantine',
    sentence:
      'It contains a form control, and forms are not imported automatically: ' +
      'its endpoint, submission behavior and data-handling requirements must ' +
      'be verified rather than importing a form that only looks functional.',
  },
  {
    code: 'embed-element',
    disposition: 'quarantine',
    sentence:
      'It contains an iframe, and an embed is a policy decision about a third ' +
      'party — provider, sandbox, referrer policy, consent — rather than a ' +
      'mapping exercise.',
  },
  {
    code: 'inline-svg',
    disposition: 'quarantine',
    sentence:
      'It has inline SVG outside every editable region, which the structured model ' +
      'cannot carry: the tag allowlist is closed around elements that ' +
      'neither fetch nor execute, and an icon is a name from a sprite rather ' +
      'than markup. SVG inside an icon region is counted as an icon field ' +
      'instead; neither is proof of an equivalent code-owned icon.',
  },
  {
    code: 'static-text',
    disposition: 'quarantine',
    sentence:
      'It has copy outside every editable region, and the structured model has ' +
      'no static-text node — the words would simply disappear from the page.',
  },
  {
    code: 'text-region-markup',
    disposition: 'quarantine',
    sentence:
      'One of its plain-text regions contains markup — a line break, an ' +
      'emphasis, a span a headline colours one word with — and a text field ' +
      'renders an escaped string, so no author value could put that markup ' +
      'back and importing it would flatten the words onto one unemphasised ' +
      'line. A richtext region carrying the same markup is not this: that ' +
      'field renders sanitized HTML, and the markup is the sample value it ' +
      'replaces.',
  },

  // ------------------------------------------ the markup exceeds the allowlist
  {
    code: 'unsupported-element',
    disposition: 'quarantine',
    sentence:
      'It uses an element that is not on the structured tag allowlist, and ' +
      'substituting a permitted tag would change what the page means.',
  },
  {
    code: 'unsupported-attribute',
    disposition: 'quarantine',
    sentence:
      'It carries an attribute that the current structured schema does not allow on an ' +
      'element node, and dropping the attribute would change how the section ' +
      'renders without saying so.',
  },
  {
    code: 'field-attributes-lost',
    disposition: 'quarantine',
    sentence:
      'Its link or image element carries an attribute that a field node’s ' +
      'governed static set still cannot hold — an inline style, a data-* hook ' +
      'V1’s own scripts read, or a class list with a token the value grammar ' +
      'refuses — and the element is refused whole rather than imported without ' +
      'it, because carrying the tokens that fit and dropping the one that does ' +
      'not is how a section comes to render and look wrong.',
  },
  {
    code: 'link-wraps-content',
    disposition: 'quarantine',
    sentence:
      'One of its links wraps other content, and a link field node renders a ' +
      'single anchor around its own label rather than a container.',
  },
  {
    code: 'nested-editable',
    disposition: 'quarantine',
    sentence:
      'One editable region contains another, and a field node has no children ' + 'for the inner one to live in.',
  },
  {
    code: 'unexpected-field-element',
    disposition: 'quarantine',
    sentence:
      'An editable region is on an element its declared type does not fit — a ' +
      'link that is not an anchor, or an image that is not an img.',
  },

  // ------------------------------------------------- the inputs disagree, or fail
  {
    code: 'html-parse-failed',
    disposition: 'quarantine',
    sentence:
      'Its markup could not be parsed under rules strict enough to import ' +
      'from, and a parser that recovers from what it does not understand ' +
      'produces a tree nobody authored.',
  },
  {
    code: 'too-deep',
    disposition: 'quarantine',
    sentence:
      'Its markup nests deeper than a structured document is allowed to, so ' +
      'there is no document this importer could produce that storage would ' +
      'accept.',
  },
  {
    code: 'slot-integrity',
    disposition: 'quarantine',
    sentence:
      'Its declared slots and its editable regions do not describe the same ' +
      'set, so there is no single answer to what this definition’s fields are.',
  },
  {
    code: 'interaction-preset-css',
    disposition: 'quarantine',
    sentence:
      'Its layout depends on INTERACTION_PRESET_CSS, a stylesheet V1 injects ' +
      'once per page, and that dependency was unavailable or could not be ' +
      'preserved under the section CSS policy. Importing without it would ' +
      'silently change the design.',
  },
  {
    code: 'css-rejected',
    disposition: 'quarantine',
    sentence:
      'Its stylesheet was refused by the CSS policy, and a section whose CSS ' +
      'cannot ship is not a section that was imported.',
  },
  {
    code: 'css-policy-dropped',
    disposition: 'quarantine',
    sentence:
      'The CSS policy dropped part of its stylesheet, so the imported section ' +
      'would render with less styling than V1 gave it and nothing on the page ' +
      'would say so.',
  },
  {
    code: 'document-invalid',
    disposition: 'quarantine',
    sentence:
      'The document this importer built did not pass the renderer’s own ' +
      'validator, which is a bug in the mapping rather than a fact about the ' +
      'definition, and it is refused for exactly that reason.',
  },

  // ---------------------------------------------------- somebody has to decide
  {
    code: 'site-divergence',
    disposition: 'manual-decision',
    sentence:
      'Its markup is retained as separate source-site variants. The parent ' +
      'registry row has no canonical import; use the destination site’s ' +
      'hashed variant subreceipt. No owner choice of a canonical site remains.',
  },
  {
    code: 'unresolved-anchor',
    disposition: 'manual-decision',
    sentence:
      'It links to an in-page anchor that no definition in the catalogue ' +
      'provides, so the imported section would carry a link that goes nowhere ' +
      'until somebody says what it was for.',
  },
]

/**
 * The codes, by name.
 *
 * A `Map` built once from a literal list rather than an object literal, so the
 * declaration order above is the order reports use — see `REASON_ORDER`. Object
 * key order would have worked here too and would have stopped working the first
 * time a code was numeric.
 */
const REASONS = new Map(REASON_LIST.map(reason => [reason.code, reason]))

/** Every code, in declaration order, which is the order reports group by. */
export const REASON_ORDER: readonly string[] = REASON_LIST.map(reason => reason.code)

export type ReasonCode = string

/**
 * Look up a code and attach the varying part, or throw.
 *
 * Throwing rather than fabricating a reason: an unknown code reaching a report
 * means this package's own vocabulary and its own call sites have drifted, and
 * the report is the last place that should be papering over that.
 */
export function reason(code: ReasonCode, detail?: string): Reason {
  const found = REASONS.get(code)
  if (found === undefined) throw new Error(`${code} is not a reason this importer knows`)
  return detail === undefined ? { ...found } : { ...found, detail }
}

/** The three outcomes a definition can have. */
export const IMPORT_STATUSES = ['automatic', 'quarantined', 'manual-decision'] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/**
 * The status a set of reasons adds up to.
 *
 * Quarantine wins over a pending decision, and deliberately: a definition that
 * needs both a repeat node and a canonicality ruling is not waiting on the
 * ruling. Reporting the decision would put it on somebody's list as though
 * settling it would unblock the import, which it would not. Every reason is
 * still recorded — only the headline is decided here.
 */
export function statusFor(reasons: readonly Reason[]): ImportStatus {
  if (reasons.some(r => r.disposition === 'quarantine')) return 'quarantined'
  if (reasons.length > 0) return 'manual-decision'
  return 'automatic'
}

/**
 * Reasons in a stable order, with duplicates of the same code and detail
 * collapsed.
 *
 * Sorted by the declaration order above and then by detail, so a rerun that
 * happens to visit the same markup in the same order — which it always does —
 * cannot be the only thing keeping the output stable.
 */
export function orderReasons(reasons: readonly Reason[]): Reason[] {
  const unique = new Map<string, Reason>()
  for (const item of reasons) unique.set(`${item.code} ${item.detail ?? ''}`, item)
  return [...unique.values()].sort((a, b) => {
    const byCode = REASON_ORDER.indexOf(a.code) - REASON_ORDER.indexOf(b.code)
    if (byCode !== 0) return byCode
    return (a.detail ?? '').localeCompare(b.detail ?? '', 'en')
  })
}
