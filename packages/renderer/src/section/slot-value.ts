import postcss from 'postcss'
import { renderSiteWidget } from '../site-widgets.ts'
import { imageFocusPosition, siteWidget, trackedLinkUrl, type SlotDef } from '@cms/schema'
import { isTypedAttributeBinding, type AstNode } from '../compile.ts'
import { isKnownContext } from '../context.ts'
import { escapeAttribute, escapeText, safeUrl, safeUrlAttribute } from '../escape.ts'
import { presentRichText } from '../richtext.ts'
import { isGovernedEmbedKind, renderGovernedEmbed } from '../governed-embeds.ts'
import { scopeCss } from '../css.ts'
import { buttonAppearanceClasses } from '../button-appearance.ts'
import { REVIEWED_ORIGINAL_NAVIGATION, type RenderOptions } from '../types.ts'

/**
 * Render one value into the sink its slot actually lands in.
 *
 * The context comes from the compiler, which walked the template with an HTML
 * tokenizer (context.ts). Nothing here re-derives it: a renderer that decides
 * for itself where a value is going is a renderer that can disagree with the
 * thing that validated the template.
 *
 * Every branch fails closed. A context this function does not recognise, a slot
 * kind that cannot go where it was put, an AST that arrived without a context
 * at all — each renders nothing rather than falling through to "escape it as
 * text and hope", which is what version 1 did and how a value in `href` became
 * a live `javascript:` URL.
 */
export function renderSlot(
  node: Extract<AstNode, { kind: 'slot' }>,
  values: Record<string, unknown>,
  options: RenderOptions,
  slot?: SlotDef,
): string {
  const widget = siteWidget(slot)
  if (widget)
    return node.context === 'element-text'
      ? renderSiteWidget(
          widget,
          widget === 'contact-form' && slot?.constraints.echelonContact === true
            ? { ...options.siteWidgets, contactStyle: 'echelon' }
            : widget === 'chapter-directory' && slot?.constraints.echelonDirectory === true
              ? { ...options.siteWidgets, chapterDirectoryStyle: 'echelon' }
              : options.siteWidgets,
        )
      : ''
  // A site menu is never a stored value (ADR 0010), so it is decided before
  // the value is even read, and only between tags.
  if (node.slotKind === 'navigation') {
    return node.context === 'element-text'
      ? slot?.constraints?.['menuStyle'] === 'bt2027-bootstrap5'
        ? (options[REVIEWED_ORIGINAL_NAVIGATION] ?? options.siteNavigation ?? '')
        : (options.siteNavigation ?? '')
      : ''
  }
  const raw = values[node.slotId]
  if (raw === undefined || raw === null) {
    // An empty governed embed still tells the editor, in preview, what to
    // paste (a library section is inserted with no link); visitors see nothing.
    return (node.slotKind === 'link' || node.slotKind === 'button') &&
      node.context === 'element-text' &&
      isGovernedEmbedKind(slot?.constraints?.['embed'])
      ? renderSlot(node, { [node.slotId]: { url: '' } }, options, slot)
      : ''
  }

  // The context reaching this function has already been re-derived from the
  // node list by bindContexts, so it is the tokenizer's answer rather than the
  // stored row's claim. This check is the last one in the chain and stays
  // anyway: an unrecognised context has no escaper, and "no escaper" must mean
  // "no output", never "fall through to the text one".
  const context = node.context
  if (!isKnownContext(context)) return ''

  if (context !== 'element-text') {
    // Typed fields contribute only their fixed scalar for the named sink.
    // The surrounding img/a markup remains definition-owned, including SVG
    // children and layout attributes. Media hydration has already supplied src.
    if (isTypedAttributeBinding(node.slotKind, context, node.attribute)) {
      const value = typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      if (node.slotKind === 'image') {
        if (node.attribute === 'src') return escapeAttribute(safeUrl(String(value['src'] ?? '')))
        const decorative = value['decorative'] === true || String(value['alt'] ?? '') === ''
        if (node.attribute === 'role') return decorative ? 'presentation' : ''
        return escapeAttribute(decorative ? '' : String(value['alt'] ?? ''))
      }
      return escapeAttribute(safeUrl(String(value['url'] ?? '')))
    }
    // All remaining attribute sinks accept plain text only.
    if (node.slotKind !== 'text') return ''
    const value = String(raw)
    switch (context) {
      case 'quoted-attribute':
        return escapeAttribute(value)
      case 'url-attribute':
        // The URL policy first, then attribute escaping. Doing only the second
        // produced a correctly-quoted javascript: URL.
        //
        // Which URL policy depends on the attribute, because `srcset` and
        // `ping` hold lists. The attribute name here is the tokenizer's, put
        // back by bindContexts on every render, not the stored row's claim.
        return escapeAttribute(safeUrlAttribute(node.attribute, value))
      case 'style-attribute':
        // A style attribute is a declaration list, not a string. It goes
        // through the same CSS policy as a stylesheet, wrapped in a throwaway
        // rule so the parser sees something well-formed.
        return escapeAttribute(inlineStyle(value))
      default:
        // event-attribute, srcdoc-attribute, unquoted-attribute,
        // attribute-name, tag-name, comment, raw-text, unknown.
        return ''
    }
  }

  switch (node.slotKind) {
    case 'text': {
      if (
        slot?.constraints?.presentation === 'cms-date-long-v1' &&
        typeof raw === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ) {
        const date = new Date(raw + 'T00:00:00Z')
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw)
          return escapeText(
            new Intl.DateTimeFormat('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(date),
          )
      }
      if (
        slot?.constraints?.presentation === 'cms-date-calendar-v1' &&
        typeof raw === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ) {
        const date = new Date(raw + 'T00:00:00Z')
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw)
          return (
            '<time datetime="' +
            raw +
            '"><span>' +
            new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date).toUpperCase() +
            '</span><strong>' +
            raw.slice(8) +
            '</strong></time>'
          )
      }
      const source =
        values.__cms_data_sources && typeof values.__cms_data_sources === 'object'
          ? (values.__cms_data_sources as Record<string, unknown>)[node.slotId]
          : null
      return (
        escapeText(String(raw)) +
        (typeof source === 'string' ? '<small class="cms-data-source">' + escapeText(source) + '</small>' : '')
      )
    }
    case 'richtext':
      // A definition may fix its blocks' and marks' classes and style (an
      // imported source's styled paragraphs and emphasis), and an inline field
      // holds only words and marks; the value itself stays canonical.
      return presentRichText(String(raw), slot?.constraints)
    case 'link':
    case 'button': {
      const value =
        typeof raw === 'object' ? (raw as Record<string, unknown>) : { url: String(raw), label: String(raw) }
      // A governed embed field: the pasted link becomes a video, map or form
      // from an allowlisted provider, or nothing (governed-embeds.ts).
      const embed = slot?.constraints?.['embed']
      if (isGovernedEmbedKind(embed)) {
        const text = (key: string) =>
          typeof slot?.constraints?.[key] === 'string' ? (slot.constraints[key] as string) : undefined
        const title = text('embedTitle'),
          empty = text('embedHelp'),
          frameClass = text('embedFrameClass'),
          placeholderClass = text('embedPlaceholderClass')
        return renderGovernedEmbed(embed, value['url'], title ?? String(value['label'] ?? ''), {
          ...(options.preview ? { preview: true } : {}),
          ...(options.providerEmbeds === false ? { providerEmbeds: false } : {}),
          ...(empty !== undefined ? { empty } : {}),
          ...(frameClass !== undefined ? { frameClass } : {}),
          ...(placeholderClass !== undefined ? { placeholderClass } : {}),
        })
      }
      const url = safeUrl(trackedLinkUrl(safeUrl(String(value['url'] ?? '')), value['trackingCode']))
      const label = escapeText(String(value['label'] ?? ''))
      // An editor's per-link choices: a new tab, which always gets
      // `noopener` so the page it opens cannot reach back, and `nofollow`.
      const newTab = value['newTab'] === true
      const tokens = [
        value['nofollow'] === true ? 'nofollow' : '',
        /^https?:/i.test(url) || newTab ? 'noopener' : '',
      ].filter(Boolean)
      const rel = (tokens.length ? ` rel="${tokens.join(' ')}"` : '') + (newTab ? ' target="_blank"' : '')
      const customButton = buttonAppearanceClasses(value['buttonAppearance'])
      const appearance = customButton
        ? ` class="${customButton}"`
        : node.slotKind === 'button' && options.siteThemeHooks === true
          ? ' class="cms-button"'
          : ''
      return `<a${appearance} href="${escapeAttribute(url)}"${rel}>${label}</a>`
    }
    case 'image': {
      const value = typeof raw === 'object' ? (raw as Record<string, unknown>) : { src: String(raw) }
      const src = safeUrl(String(value['src'] ?? ''))
      const alt = String(value['alt'] ?? '')
      // An image is described or explicitly decorative; there is no third case.
      const decorative = value['decorative'] === true || alt === ''
      const attributes = decorative ? 'alt="" role="presentation"' : `alt="${escapeAttribute(alt)}"`
      const focus = imageFocusPosition(value['focal'])
      return `<img src="${escapeAttribute(src)}" ${attributes}${focus ? ` style="object-position:${focus}"` : ''}>`
    }
    case 'repeat':
      // Collections bind here in M4; rendering nothing is correct until then,
      // and the readiness policy is what notices an empty required region.
      return ''
    default:
      return ''
  }
}

/**
 * A `style="..."` value, run through the stylesheet policy.
 *
 * Treating it as ordinary escaped text let `background:url(//evil.test/x)` ship
 * — correctly quoted, and still a request to somebody else's server on every
 * page view. Wrapping it in a throwaway rule reuses the one CSS policy rather
 * than growing a second, weaker one for inline styles.
 */
function inlineStyle(value: string): string {
  // Wrapped in a throwaway rule under a real class scope. A bare `a` was used
  // before, which stopped working the moment scopes became parsed tokens rather
  // than strings — a tag is not a scope, and a scope that is not a class or an
  // id is not one this policy can confine anything to.
  const { css, blocking } = scopeCss(`${INLINE_STYLE_SCOPE.slice(1)}{${value}}`, INLINE_STYLE_SCOPE)
  if (blocking.length > 0) return ''
  // Read the declarations from the parsed rule: a brace inside a quoted value
  // such as content:"}" must not end the list early.
  const rule = postcss.parse(css).first
  if (!rule || rule.type !== 'rule') return ''
  return rule.nodes
    .filter(node => node.type === 'decl')
    .map(node => node.toString())
    .join(';')
}

/** The scope an inline `style="…"` value is checked under. Never emitted. */
const INLINE_STYLE_SCOPE = '.cms-inline-style'
