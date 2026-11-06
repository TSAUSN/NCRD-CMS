import {
  activeHeroSlideKeys,
  heroSlidePresentation,
  repeatItemKeys,
  repeatItemSlotId,
  type FieldLike,
} from '@cms/schema'
import { renderCmsIcon } from './icons.ts'
import { escapeAttribute } from './escape.ts'
import { parseHtml, type HtmlElement, type HtmlNode } from './source-html.ts'
/** Opted-in template version only; future slides stay available to the date-aware runtime. */
export function renderParityHeroSlides(
  html: string,
  index: number,
  slot: FieldLike,
  values: Record<string, unknown>,
  editing: boolean,
  now: number,
): string {
  const keys = repeatItemKeys(values[slot.id]),
    shown = editing ? keys : activeHeroSlideKeys(values, slot.id, now),
    parsed = parseHtml(html, { locations: true })
  if (!parsed.ok) return ''
  const all: HtmlElement[] = []
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes)
      if (node.kind === 'element') {
        all.push(node)
        walk(node.children)
      }
  }
  walk(parsed.nodes)
  const has = (node: HtmlElement, name: string) =>
      node.attributes.some(attr => attr.name === 'class' && attr.value.split(/\s+/).includes(name)),
    track = all.find(node => has(node, 'cms-hero-slider')),
    slides =
      track?.children.filter((node): node is HtmlElement => node.kind === 'element' && has(node, 'cms-hero-slide')) ??
      []
  if (!track?.source || slides.length !== keys.length || slides.some(slide => !slide.source)) return ''
  const included = editing ? keys : keys.filter(key => values[repeatItemSlotId(slot.id, key, 'enabled')] !== 'off')
  const id = (key: string) => `cms-hero-s${index}-${key}`,
    edits: { at: number; end: number; value: string }[] = [],
    attribute = (node: HtmlElement, text: string) =>
      edits.push({
        at: node.source!.start + 1 + node.tag.length,
        end: node.source!.start + 1 + node.tag.length,
        value: text,
      })
  if (index > 0) {
    const heading = all.find(node => node.tag === 'h1' && has(node, 'national-sr'))
    if (heading?.source) edits.push({ at: heading.source.start, end: heading.source.end, value: '' })
  }
  attribute(
    track,
    ' data-cms-hero="' +
      escapeAttribute(slot.id) +
      '" data-cms-hero-windowed="true"' +
      (editing ? ' data-cms-hero-editing="true"' : '') +
      (!shown.length ? ' hidden' : '') +
      ' role="region" aria-roledescription="carousel"',
  )
  for (const [at, slide] of slides.entries()) {
    const key = keys[at]!
    if (!included.includes(key)) {
      edits.push({ at: slide.source!.start, end: slide.source!.end, value: '' })
      continue
    }
    const p = heroSlidePresentation(values, slot.id, key)
    attribute(
      slide,
      ` id="${id(key)}" data-cms-hero-key="${key}" data-hero-position="${p.position}" data-hero-shade="${p.shade}" data-hero-phone="${p.phone ? 'on' : 'off'}" data-hero-main="${p.main ? 'on' : 'off'}" data-hero-second="${p.second ? 'on' : 'off'}" data-hero-main-color="${p.mainColor}" data-hero-second-color="${p.secondColor}" aria-label="Slide ${Math.max(0, shown.indexOf(key)) + 1} of ${shown.length}"${!shown.includes(key) ? ' hidden' : ''}`,
    )
    if (!editing) {
      const descendants: HtmlElement[] = []
      const gather = (nodes: HtmlNode[]) => {
        for (const node of nodes)
          if (node.kind === 'element') {
            descendants.push(node)
            gather(node.children)
          }
      }
      gather(slide.children)
      for (const [name, visible] of [
        ['cms-hero-main', p.main],
        ['cms-hero-second', p.second],
      ] as const) {
        if (visible) continue
        const block = descendants.find(node => has(node, name))
        if (block?.source) edits.push({ at: block.source.start, end: block.source.end, value: '' })
      }
    }
    const next = shown[(shown.indexOf(key) + 1) % shown.length],
      dots = included
        .map(
          (other, n) =>
            `<a class="cms-hero-dot" href="#${id(other)}" data-cms-hero-target="${n}" data-cms-hero-control="dot" aria-label="${escapeAttribute('Slide ' + (n + 1) + ': ' + String(values[repeatItemSlotId(slot.id, other, 'title')] ?? 'Untitled slide'))}"${other === key ? ' aria-current="true"' : ''}${!shown.includes(other) ? ' hidden' : ''}><span aria-hidden="true">●</span></a>`,
        )
        .join('')
    const controls = `<nav class="cms-hero-controls" aria-label="Choose a slide"${shown.length < 2 ? ' hidden' : ''}><span class="cms-hero-dots">${dots}</span><a class="cms-hero-arrow" href="#${id(next ?? keys[0]!)}" data-cms-hero-target="${Math.max(0, included.indexOf(next ?? included[0]!))}" data-cms-hero-control="next" aria-label="Next slide">${renderCmsIcon('chevron-right')}</a></nav>`
    edits.push({ at: slide.source!.closeStart, end: slide.source!.closeStart, value: controls })
  }
  for (const edit of edits.sort((a, b) => b.at - a.at))
    html = html.slice(0, edit.at) + edit.value + html.slice(edit.end)
  return html
}
export const HERO_BUTTON_PALETTE = {
  red: { background: '#ef3e42', foreground: '#ffffff', border: '#ef3e42' },
  white: { background: '#ffffff', foreground: '#172033', border: '#d9dde4' },
} as const
export const HERO_PRESENTATION_CSS = `
#cms-main>.cms-section:has([data-cms-hero-windowed][hidden]){display:none}
[data-cms-hero-windowed]>.cms-hero-slide[hidden],[data-cms-hero-windowed][hidden],[data-cms-hero-windowed] .cms-hero-controls[hidden],[data-cms-hero-windowed] .cms-hero-dot[hidden]{display:none!important}
[data-cms-hero-windowed] .cms-hero-phone-picture{display:none;position:absolute;inset:0;z-index:-2}[data-cms-hero-windowed] .cms-hero-phone-picture img,[data-cms-hero-windowed] .cms-hero-phone-picture cms-slot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#cms-main [data-cms-hero-windowed] .national-hero-copy{position:relative;width:min(720px,100%);box-sizing:border-box}
[data-cms-hero-windowed] [data-hero-position=center]{justify-content:center;text-align:center}[data-cms-hero-windowed] [data-hero-position=center] .national-actions{justify-content:center}
[data-cms-hero-windowed] [data-hero-position=right]{justify-content:flex-end;text-align:right}[data-cms-hero-windowed] [data-hero-position=right] .national-actions{justify-content:flex-end}
#cms-main [data-cms-hero-windowed] [data-hero-shade=blue]:after{background:linear-gradient(90deg,rgba(0,0,0,.75),rgba(0,32,86,.35))}
#cms-main [data-cms-hero-windowed] [data-hero-shade=black]:after{background:rgba(0,0,0,.5)}
#cms-main [data-cms-hero-windowed] [data-hero-shade=white]:after{background:rgba(255,255,255,.88)}
#cms-main [data-cms-hero-windowed] [data-hero-shade=none]:after{background:none}
#cms-main [data-cms-hero-windowed] [data-hero-shade=white] .national-hero-copy,#cms-main [data-cms-hero-windowed] [data-hero-shade=white] .national-hero-copy h2{color:#172033;text-shadow:none}
[data-cms-hero-windowed] [data-hero-main=off] .cms-hero-main,[data-cms-hero-windowed] [data-hero-second=off] .cms-hero-second{display:none}
[data-cms-hero-windowed] .national-actions>span{display:contents}
[data-cms-hero-windowed] [data-hero-main-color=red] .cms-hero-main a,[data-cms-hero-windowed] [data-hero-second-color=red] .cms-hero-second a{background:${HERO_BUTTON_PALETTE.red.background};color:${HERO_BUTTON_PALETTE.red.foreground};border:1px solid ${HERO_BUTTON_PALETTE.red.border}}
[data-cms-hero-windowed] [data-hero-main-color=white] .cms-hero-main a,[data-cms-hero-windowed] [data-hero-second-color=white] .cms-hero-second a{background:${HERO_BUTTON_PALETTE.white.background};color:${HERO_BUTTON_PALETTE.white.foreground};border:1px solid ${HERO_BUTTON_PALETTE.white.border}}
[data-cms-hero-windowed] [data-hero-main-color=outline] .cms-hero-main a,[data-cms-hero-windowed] [data-hero-second-color=outline] .cms-hero-second a{background:transparent;color:inherit;border:1px solid currentColor}
@media(max-width:575px){[data-cms-hero-windowed] [data-hero-phone=on]>.cms-hero-phone-picture{display:block}[data-cms-hero-windowed] [data-hero-phone=on]>img,[data-cms-hero-windowed] [data-hero-phone=on]>cms-slot{display:none}}
`
