// Where a slot sits in its template, decided by an HTML tokenizer rather than
// by looking around for angle brackets.
//
// "Content or attribute" is not enough information to escape with. A value
// bound for `href` needs the URL policy; one bound for `style` needs the CSS
// policy; one bound for `onclick` needs to not exist. And an unquoted attribute
// value cannot be made safe by escaping at all — a space ends it, so the next
// thing the author's value says becomes a new attribute. Those are five
// different sinks, and a template compiler that knows only two of them will
// pick the wrong escaper four times out of five.
//
// The states below follow the HTML tokenizer's own, because that is the thing
// whose behaviour has to be predicted. Templates are authored content compiled
// once, so the cost of scanning them properly is paid at save time and never
// on a request.
//
// WHY NOT A CONFORMING PARSER
//
// parse5 and friends build a document, and a document is exactly what this is
// not looking for. The positions that matter most here are the invalid ones — a
// slot in a tag name, a slot in an attribute name, a slot in an unquoted value
// — and a conforming parser's job is to normalise those away into something
// well-formed. It also discards the byte offsets that tell us *which*
// `{{slot}}` was where. So the tokenizer states are modelled directly, and the
// one rule that is easy to get wrong is spelled out below rather than
// approximated.

/**
 * Attributes whose value is fetched or navigated.
 *
 * Exported because `escape.ts` has to classify every one of them by the grammar
 * it actually holds — single URL, space-separated list, srcset candidates, or
 * not a URL at all — and a member here with no entry there would silently get
 * the single-URL policy applied to something that is not a single URL. A test
 * holds the two in step.
 */
export const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'poster',
  'data',
  'ping',
  'cite',
  'background',
  'longdesc',
  'usemap',
  'manifest',
  'archive',
  'codebase',
  'profile',
  'icon',
  'xlink:href',
  'xmlns',
  'xmlns:xlink',
  'from',
  'to',
  'values',
])

/** Elements whose content is raw text: markup inside them is not markup. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes'])

export type SlotContext =
  /** Between tags. The only place markup-emitting slots may go. */
  | 'element-text'
  /** Inside a quoted value of an ordinary attribute. Escape quotes too. */
  | 'quoted-attribute'
  /** Inside a quoted value of an attribute that is fetched or navigated. */
  | 'url-attribute'
  /** Inside a quoted `style` value. A stylesheet, not a string. */
  | 'style-attribute'
  /** Inside an `on*` handler. There is no escaping that makes this data. */
  | 'event-attribute'
  /** Inside `srcdoc`, which is a whole document with no URL to filter. */
  | 'srcdoc-attribute'
  /** An attribute value with no quotes: whitespace ends it. */
  | 'unquoted-attribute'
  /** The attribute's name, where a value chooses which attribute exists. */
  | 'attribute-name'
  /** The tag's name, where a value chooses which element exists. */
  | 'tag-name'
  /** Inside a comment, which a value can close. */
  | 'comment'
  /** Inside script/style/title/textarea, where escaping does not apply. */
  | 'raw-text'
  /** The scanner could not tell. Treated as unsafe, because it is unknown. */
  | 'unknown'

/** Contexts a value may be rendered into, each with its own escaping. */
const SAFE_CONTEXTS: readonly SlotContext[] = ['element-text', 'quoted-attribute', 'url-attribute', 'style-attribute']

export function isSafeContext(context: SlotContext): boolean {
  return (SAFE_CONTEXTS as readonly string[]).includes(context)
}

/** Why a context is refused, in words an author can act on. */
export const CONTEXT_REFUSALS: Record<
  Exclude<SlotContext, 'element-text' | 'quoted-attribute' | 'url-attribute' | 'style-attribute'>,
  string
> = {
  'event-attribute': 'sits inside an event handler, where a value would be code rather than content',
  'srcdoc-attribute': 'sits inside srcdoc, which is a whole document and cannot be made safe',
  'unquoted-attribute':
    'sits in an unquoted attribute value, where a space would start a new attribute — put quotes around it',
  'attribute-name': 'is used as an attribute name, which would let content choose which attribute exists',
  'tag-name': 'is used as a tag name, which would let content choose which element exists',
  comment: 'sits inside an HTML comment, which a value could close',
  'raw-text': 'sits inside a script, style, title or textarea element, where escaping does not apply',
  unknown: 'sits somewhere this compiler cannot classify, so it is refused rather than guessed at',
}

export type SlotSite = {
  /** Offset of the opening `{{`. */
  index: number
  /** Length of the whole `{{ id }}` token. */
  length: number
  slotId: string
  /** `{{#id}}` opens and `{{/id}}` closes a repeated item's markup (LIB-02). */
  marker?: 'start' | 'end'
  context: SlotContext
  /** The attribute this lands in, lowercased, when there is one. */
  attribute?: string
  /** Opening tag offset for preview instrumentation; never persisted as authority. */
  elementStart?: number
}

const TOKEN = /^\{\{\s*([#/]?)([\w-]+)\s*\}\}/

type State =
  | 'data'
  | 'tag-open'
  | 'end-tag-open'
  | 'tag-name'
  | 'before-attribute-name'
  | 'attribute-name'
  | 'after-attribute-name'
  | 'before-attribute-value'
  | 'attribute-value-double'
  | 'attribute-value-single'
  | 'attribute-value-unquoted'
  | 'after-attribute-value'
  | 'self-closing'
  | 'comment'
  | 'bogus-comment'
  | 'raw-text'

function attributeContext(name: string): SlotContext {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) return 'event-attribute'
  if (lower === 'srcdoc') return 'srcdoc-attribute'
  if (lower === 'style') return 'style-attribute'
  if (URL_ATTRIBUTES.has(lower)) return 'url-attribute'
  return 'quoted-attribute'
}

/**
 * Whether markup opens a script element — decided by looking at the text, with
 * no tokenizer state involved at all.
 *
 * Deciding this from the walk below was wrong, and Chromium says why. Inside
 * `<svg>` and `<math>` the raw-text elements are not raw text: `<svg><title>`,
 * `<svg><textarea>`, `<svg><style>`, `<svg><xmp>` and `<svg><noembed>` all
 * parse their content as markup, so `<svg><title><script>…</script></title>`
 * runs the script. The walk, which treats `title` as raw text everywhere, never
 * saw that script — and a template could carry one *and* editable slots past
 * the rule that says it may not.
 *
 * Getting the walk to agree would mean implementing HTML's foreign-content
 * algorithm, integration points and all — `<math><mi><title>` is HTML again, so
 * *there* a script really is inert. That is the same "language implementation"
 * this file already declines to attempt for the script-data states, and the
 * same reasoning applies: the rule does not need to know where the script is,
 * only that there is one.
 *
 * So the test is deliberately blunt and slightly over-strict. It matches the
 * database's `render_ast_defect` exactly, which means the compiler and the
 * storage gate now refuse the same templates rather than the compiler accepting
 * something the database would reject with a less helpful message.
 */
const SCRIPT_ELEMENT = /<\s*script[\s/>]/i

export function opensScriptElement(markup: string): boolean {
  return SCRIPT_ELEMENT.test(markup)
}

/**
 * Walk the template and report the context of every `{{slot}}` in it.
 *
 * One pass, in tokenizer order, so the state at the moment a slot is reached is
 * the state a browser would be in at that point — not something reconstructed
 * afterwards by looking backwards for the nearest `<`.
 */
export function scanSlotSites(html: string): SlotSite[] {
  const sites: SlotSite[] = []
  let state: State = 'data'
  let attribute = ''
  let tagName = ''
  let rawTextTag = ''
  let endTag = false
  let elementStart = -1
  let i = 0

  const contextNow = (): { context: SlotContext; attribute?: string } => {
    switch (state) {
      case 'data':
        return { context: 'element-text' }
      case 'raw-text':
        return { context: 'raw-text' }
      case 'comment':
      case 'bogus-comment':
        return { context: 'comment' }
      case 'tag-open':
      case 'end-tag-open':
      case 'tag-name':
        return { context: 'tag-name' }
      case 'before-attribute-name':
      case 'attribute-name':
      case 'after-attribute-name':
        return { context: 'attribute-name' }
      case 'before-attribute-value':
      case 'attribute-value-unquoted':
        return { context: 'unquoted-attribute', attribute }
      case 'attribute-value-double':
      case 'attribute-value-single':
        return { context: attributeContext(attribute), attribute: attribute.toLowerCase() }
      // A slot in any other structural position is not classified, and an
      // unclassified position is refused rather than assumed to be content.
      default:
        return { context: 'unknown' }
    }
  }

  while (i < html.length) {
    const token = TOKEN.exec(html.slice(i))
    if (token) {
      const { context, attribute: attr } = contextNow()
      sites.push({
        index: i,
        length: token[0].length,
        slotId: token[2]!,
        context,
        ...(token[1] === '#' ? { marker: 'start' as const } : token[1] === '/' ? { marker: 'end' as const } : {}),
        ...(attr === undefined ? {} : { attribute: attr }),
        ...(!endTag && attr !== undefined && elementStart >= 0 ? { elementStart } : {}),
      })
      i += token[0].length
      continue
    }

    const ch = html[i]!
    switch (state) {
      case 'data':
        if (ch === '<') {
          state = 'tag-open'
          elementStart = i
        }
        break
      case 'tag-open':
        if (ch === '/') {
          state = 'end-tag-open'
          tagName = ''
          endTag = true
        } else if (ch === '!') state = html.startsWith('!--', i) ? 'comment' : 'bogus-comment'
        else if (/[a-zA-Z]/.test(ch)) {
          state = 'tag-name'
          tagName = ch
          endTag = false
        } else state = 'data'
        break
      case 'end-tag-open':
        if (/[a-zA-Z]/.test(ch)) {
          state = 'tag-name'
          tagName = ch
        }
        // `</>` is HTML's missing-end-tag-name: the token is dropped and the
        // tokenizer returns to DATA. Treating it as a bogus comment ran on to
        // the *next* `>`, which can sit inside a quoted attribute value — so a
        // slot genuinely inside `title="…"` was classified as element text and
        // escaped with the wrong escaper, and a plain text value introduced
        // attributes of its own.
        else if (ch === '>') {
          state = 'data'
          endTag = false
          tagName = ''
        } else state = 'bogus-comment'
        break
      case 'tag-name':
        if (/[\s/]/.test(ch)) state = 'before-attribute-name'
        else if (ch === '>') state = closeTag()
        else tagName += ch
        break
      case 'before-attribute-name':
        if (ch === '>') state = closeTag()
        else if (!/[\s/]/.test(ch)) {
          state = 'attribute-name'
          attribute = ch
        }
        break
      case 'attribute-name':
        if (ch === '=') state = 'before-attribute-value'
        else if (ch === '>') state = closeTag()
        else if (/[\s/]/.test(ch)) state = 'after-attribute-name'
        else attribute += ch
        break
      case 'after-attribute-name':
        if (ch === '=') state = 'before-attribute-value'
        else if (ch === '>') state = closeTag()
        else if (!/[\s/]/.test(ch)) {
          state = 'attribute-name'
          attribute = ch
        }
        break
      case 'before-attribute-value':
        if (ch === '"') state = 'attribute-value-double'
        else if (ch === "'") state = 'attribute-value-single'
        else if (ch === '>') state = closeTag()
        else if (!/\s/.test(ch)) state = 'attribute-value-unquoted'
        break
      case 'attribute-value-double':
        if (ch === '"') state = 'after-attribute-value'
        break
      case 'attribute-value-single':
        if (ch === "'") state = 'after-attribute-value'
        break
      case 'attribute-value-unquoted':
        if (ch === '>') state = closeTag()
        else if (/\s/.test(ch)) state = 'before-attribute-name'
        break
      case 'after-attribute-value':
        if (ch === '>') state = closeTag()
        else if (/[\s/]/.test(ch)) state = 'before-attribute-name'
        else {
          // HTML *reconsumes* here. After a quoted value, a character that is
          // not whitespace, `/` or `>` is a parse error and the tokenizer goes
          // to before-attribute-name WITHOUT consuming it — so in
          // `<img src="x"onerror="…">` the attribute is `onerror`.
          //
          // Consuming it ate the `o`. The attribute became `nerror`, which does
          // not start with `on`, so a slot inside a live event handler was
          // classified `quoted-attribute` — a safe context — and compiled with
          // nothing blocking and no approval required. `continue` skips the
          // increment at the foot of the loop, which is what reconsuming is.
          state = 'before-attribute-name'
          continue
        }
      case 'comment':
        if (html.startsWith('-->', i)) {
          state = 'data'
          i += 2
        }
        break
      case 'bogus-comment':
        if (ch === '>') state = 'data'
        break
      case 'raw-text':
        // Only the *appropriate end tag* leaves raw text, and HTML is specific
        // about what that means: `</`, the element's own name, and then a
        // delimiter — whitespace, `/`, or `>`. Anything else is text.
        //
        // Matching on the prefix alone was the bug. `</scriptx>` starts with
        // `</script`, so the scanner left raw text early and classified
        // everything after it as element content; a browser does not, so a slot
        // there was compiled as ordinary text and executed as script.
        // A script element is never exited, and that is deliberate.
        //
        // HTML's script parsing has escaped and double-escaped states, and
        // `<script><!--<script></script>-->` does not end where it looks like
        // it ends: the inner `</script>` returns to the escaped state instead
        // of closing the element. Modelling those states correctly is a real
        // piece of specification work, and getting it subtly wrong is how a
        // slot after an apparent close was classified as ordinary text and then
        // executed. So this walk declines to guess — anything after a `<script`
        // stays raw text — and the compiler refuses the template outright if it
        // has both a script and any slot (SCRIPT_AND_SLOTS).
        if (ch === '<' && rawTextTag !== 'script' && isAppropriateEndTag(html, i, rawTextTag)) {
          state = 'end-tag-open'
          // This *is* an end tag, and saying so is what stops closeTag() from
          // reading `</script>` as another `<script>` and dropping straight
          // back into raw text — which left every slot after a legitimately
          // closed script element misclassified.
          endTag = true
          rawTextTag = ''
          i += 1
        }
        break
      default:
        state = 'data'
    }
    i += 1
  }

  return sites

  /** HTML's appropriate-end-tag rule, spelled out. */
  function isAppropriateEndTag(source: string, at: number, tag: string): boolean {
    const prefix = `</${tag}`
    if (source.slice(at, at + prefix.length).toLowerCase() !== prefix) return false
    const next = source[at + prefix.length]
    // End of input is not a delimiter: an unterminated `</script` is text, and
    // staying in raw text is the conservative reading either way.
    if (next === undefined) return false
    return (
      next === '\t' || next === '\n' || next === '\f' || next === '\r' || next === ' ' || next === '/' || next === '>'
    )
  }

  function closeTag(): State {
    const name = tagName.toLowerCase()
    const wasEndTag = endTag
    tagName = ''
    attribute = ''
    endTag = false
    // An end tag leaves raw text; only a start tag enters it.
    if (!wasEndTag && RAW_TEXT_ELEMENTS.has(name)) {
      rawTextTag = name
      return 'raw-text'
    }
    return 'data'
  }
}

/** Contexts a stored AST is allowed to name. Anything else is not a context. */
export const KNOWN_CONTEXTS: readonly SlotContext[] = [
  'element-text',
  'quoted-attribute',
  'url-attribute',
  'style-attribute',
  'event-attribute',
  'srcdoc-attribute',
  'unquoted-attribute',
  'attribute-name',
  'tag-name',
  'comment',
  'raw-text',
  'unknown',
]

export function isKnownContext(value: unknown): value is SlotContext {
  return typeof value === 'string' && (KNOWN_CONTEXTS as readonly string[]).includes(value)
}
