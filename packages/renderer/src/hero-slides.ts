import { renderParityHeroSlides, HERO_PRESENTATION_CSS } from './hero-slide-presentation.ts'
import { renderCmsIcon } from './icons.ts'
import { activeHeroSlideKeys, repeatItemKeys, repeatItemSlotId, type FieldLike } from '@cms/schema'
import { escapeAttribute } from './escape.ts'
import { parseHtml, type HtmlElement, type HtmlNode } from './source-html.ts'
/** Only the definition-owned repeated hero opts in. Authored values remain sanitized fields. */
export function renderHeroSlides(
  html: string,
  index: number,
  slot: FieldLike,
  values: Record<string, unknown>,
  editing = false,
  now = Date.now(),
): string {
  if (slot.constraints?.heroEditingParity === true)
    return renderParityHeroSlides(html, index, slot, values, editing, now)
  const keys = repeatItemKeys(values[slot.id]),
    shown = editing ? keys : activeHeroSlideKeys(values, slot.id, now)
  if (!shown.length && editing) return html
  const parsed = parseHtml(html, { locations: true })
  if (!parsed.ok) return ''
  const all: HtmlElement[] = []
  function walk(nodes: HtmlNode[]) {
    for (const node of nodes)
      if (node.kind === 'element') {
        all.push(node)
        walk(node.children)
      }
  }
  walk(parsed.nodes)
  const hasClass = (node: HtmlElement, name: string) =>
    node.attributes.some(attr => attr.name === 'class' && attr.value.split(/\s+/).includes(name))
  const track = all.find(node => hasClass(node, 'cms-hero-slider'))
  const slides =
    track?.children.filter(
      (node): node is HtmlElement => node.kind === 'element' && hasClass(node, 'cms-hero-slide'),
    ) ?? []
  if (!track?.source || slides.length !== keys.length || slides.some(slide => !slide.source)) return ''
  if (!shown.length) return html.slice(0, track.source.start) + html.slice(track.source.end)
  const id = (key: string) => `cms-hero-s${index}-${key}`,
    edits: { at: number; end: number; value: string }[] = []
  edits.push({
    at: track.source.start + 1 + track.tag.length,
    end: track.source.start + 1 + track.tag.length,
    value:
      ' data-cms-hero="' +
      escapeAttribute(slot.id) +
      '"' +
      (editing ? ' data-cms-hero-editing="true"' : '') +
      ' role="region" aria-roledescription="carousel"',
  })
  for (const [at, slide] of slides.entries()) {
    const key = keys[at]!,
      source = slide.source!,
      position = shown.indexOf(key)
    if (position < 0) {
      edits.push({ at: source.start, end: source.end, value: '' })
      continue
    }
    edits.push({
      at: source.start + 1 + slide.tag.length,
      end: source.start + 1 + slide.tag.length,
      value: ` id="${id(key)}" data-cms-hero-key="${key}" aria-label="Slide ${position + 1} of ${shown.length}"`,
    })
    if (shown.length < 2) continue
    const control = (target: number, kind: string, label: string, content: string) =>
      `<a class="cms-hero-${kind === 'dot' ? 'dot' : 'arrow'}" href="#${id(shown[target]!)}" data-cms-hero-target="${target}" data-cms-hero-control="${kind}" aria-label="${escapeAttribute(label)}"${kind === 'dot' && target === position ? ' aria-current="true"' : ''}>${content}</a>`
    const dots = shown
      .map((other, n) =>
        control(
          n,
          'dot',
          `Slide ${n + 1}: ${String(values[repeatItemSlotId(slot.id, other, 'title')] ?? '').trim() || 'Untitled slide'}`,
          '<span aria-hidden="true">●</span>',
        ),
      )
      .join('')
    const controls =
      '<nav class="cms-hero-controls" aria-label="Choose a slide"><span class="cms-hero-dots">' +
      dots +
      '</span>' +
      control((position + 1) % shown.length, 'next', 'Next slide', renderCmsIcon('chevron-right')) +
      '</nav>'
    edits.push({ at: source.closeStart, end: source.closeStart, value: controls })
  }
  for (const edit of edits.sort((a, b) => b.at - a.at))
    html = html.slice(0, edit.at) + edit.value + html.slice(edit.end)
  return html
}
export const HERO_SLIDES_CSS =
  HERO_PRESENTATION_CSS +
  `
.cms-hero-slider{position:relative;scroll-behavior:smooth;overscroll-behavior-x:contain}.cms-hero-slide{scroll-snap-stop:always}
.cms-hero-controls{position:absolute;right:16px;bottom:16px;display:flex;align-items:center;gap:8px;z-index:3}.cms-hero-dots{display:flex;align-items:center;gap:4px;padding:6px 8px;background:#ffffffd9;border-radius:999px}
.cms-hero-controls .cms-hero-dot{display:block;width:6px;height:6px;min-height:0;padding:0;border:0;border-radius:999px;background:#1c1b1f4d;font-size:0;line-height:0;text-decoration:none;transition:width .25s ease,background-color .25s ease}
.cms-hero-controls .cms-hero-dot[aria-current=true]{width:18px;background:#1c1b1f}.cms-hero-controls .cms-hero-arrow{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:#ffffffd9;color:#1c1b1f;text-decoration:none}.cms-hero-arrow>svg{width:20px;height:20px;stroke-width:2.4}.cms-hero-arrow:hover{background:white}
.cms-hero-controls a:focus-visible{outline:3px solid white;outline-offset:3px}
@media(max-width:575px){.cms-hero-controls{right:16px;bottom:16px}.cms-hero-slider .national-hero-copy{padding-bottom:72px}}
@media(prefers-reduced-motion:reduce){.cms-hero-slider{scroll-behavior:auto}.cms-hero-controls .cms-hero-dot{transition:none}}
`
