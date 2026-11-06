import { renderedFeatures } from './feature-markers.ts'
// Governed video, map and form embeds (SPEC §8: no arbitrary object
// embedding; source applications mapped/adapted explicitly). An editor pastes
// the ordinary link a provider gives them; only YouTube and Vimeo videos,
// Google Maps embeds and Microsoft or Google Forms are accepted, each rebuilt
// from its identifiers into the provider's own embed address. Nothing else
// becomes a frame. As with the Tableau charts, the public page first shows a
// code-owned consent card inside the frame: the visitor's browser contacts the
// provider only after they choose to load it, and a plain link opens it
// directly instead.
import { escapeAttribute, escapeText } from './escape.ts'

export const GOVERNED_EMBED_KINDS = ['video', 'map', 'form'] as const
export type GovernedEmbedKind = (typeof GOVERNED_EMBED_KINDS)[number]

export type GovernedEmbed = {
  kind: GovernedEmbedKind
  provider: 'youtube' | 'vimeo' | 'google-maps' | 'microsoft-forms' | 'google-forms'
  /** Shown to visitors: who they would be connecting to. */
  providerName: string
  embedUrl: string
  openUrl: string
  /** The origin (and, for shared hosts, path) the public page must allow as a frame source. */
  frameSource: string
}

export const GOVERNED_EMBED_FRAME_SOURCES = {
  youtube: 'https://www.youtube-nocookie.com',
  vimeo: 'https://player.vimeo.com',
  'google-maps': 'https://www.google.com/maps/embed',
  'microsoft-forms': 'https://forms.office.com',
  'google-forms': 'https://docs.google.com/forms/',
} as const

export function isGovernedEmbedKind(value: unknown): value is GovernedEmbedKind {
  return typeof value === 'string' && (GOVERNED_EMBED_KINDS as readonly string[]).includes(value)
}

function parse(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  return url
}

/** The governed embed a pasted link names, for one kind of section, or null. */
export function governedEmbed(kind: GovernedEmbedKind, raw: unknown): GovernedEmbed | null {
  const url = parse(raw)
  if (!url) return null
  const host = url.hostname.toLowerCase()
  const path = url.pathname
  if (kind === 'video') {
    const youtube = (() => {
      if (host === 'youtu.be') return /^\/([A-Za-z0-9_-]{11})$/.exec(path)?.[1]
      if (
        ![
          'youtube.com',
          'www.youtube.com',
          'm.youtube.com',
          'youtube-nocookie.com',
          'www.youtube-nocookie.com',
        ].includes(host)
      )
        return undefined
      if (path === '/watch')
        return /^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v') ?? '') ? url.searchParams.get('v')! : undefined
      return /^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})$/.exec(path)?.[1]
    })()
    if (youtube)
      return {
        kind,
        provider: 'youtube',
        providerName: 'YouTube',
        frameSource: GOVERNED_EMBED_FRAME_SOURCES.youtube,
        embedUrl: `https://www.youtube-nocookie.com/embed/${youtube}`,
        openUrl: `https://www.youtube.com/watch?v=${youtube}`,
      }
    const vimeo =
      host === 'vimeo.com' || host === 'www.vimeo.com'
        ? /^\/(\d{1,12})(?:\/([0-9a-f]{6,20}))?$/.exec(path)
        : host === 'player.vimeo.com'
          ? /^\/video\/(\d{1,12})$/.exec(path)
          : null
    if (vimeo) {
      const hash =
        vimeo[2] ?? (/^[0-9a-f]{6,20}$/.test(url.searchParams.get('h') ?? '') ? url.searchParams.get('h')! : '')
      return {
        kind,
        provider: 'vimeo',
        providerName: 'Vimeo',
        frameSource: GOVERNED_EMBED_FRAME_SOURCES.vimeo,
        embedUrl: `https://player.vimeo.com/video/${vimeo[1]}?dnt=1${hash ? `&h=${hash}` : ''}`,
        openUrl: `https://vimeo.com/${vimeo[1]}${hash ? `/${hash}` : ''}`,
      }
    }
    return null
  }
  if (kind === 'map') {
    const pb = url.searchParams.get('pb') ?? ''
    if (host !== 'www.google.com' || path !== '/maps/embed' || !/^[A-Za-z0-9!._:%-]{1,4000}$/.test(pb)) return null
    const embedUrl = `https://www.google.com/maps/embed?pb=${pb}`
    return {
      kind,
      provider: 'google-maps',
      providerName: 'Google Maps',
      frameSource: GOVERNED_EMBED_FRAME_SOURCES['google-maps'],
      embedUrl,
      openUrl: embedUrl,
    }
  }
  if (host === 'forms.office.com' || host === 'forms.microsoft.com') {
    const short = /^\/r\/([A-Za-z0-9]{6,20})$/.exec(path)?.[1]
    const id =
      path === '/Pages/ResponsePage.aspx' && /^[A-Za-z0-9_-]{10,300}$/.test(url.searchParams.get('id') ?? '')
        ? url.searchParams.get('id')!
        : null
    if (!short && !id) return null
    const page = short
      ? `https://forms.office.com/r/${short}`
      : `https://forms.office.com/Pages/ResponsePage.aspx?id=${id}`
    return {
      kind,
      provider: 'microsoft-forms',
      providerName: 'Microsoft Forms',
      frameSource: GOVERNED_EMBED_FRAME_SOURCES['microsoft-forms'],
      embedUrl: `${page}${short ? '?' : '&'}embed=true`,
      openUrl: page,
    }
  }
  if (host === 'docs.google.com') {
    const id = /^\/forms\/d\/e\/([A-Za-z0-9_-]{20,200})\/(?:viewform|formResponse)$/.exec(path)?.[1]
    if (!id) return null
    return {
      kind,
      provider: 'google-forms',
      providerName: 'Google Forms',
      frameSource: GOVERNED_EMBED_FRAME_SOURCES['google-forms'],
      embedUrl: `https://docs.google.com/forms/d/e/${id}/viewform?embedded=true`,
      openUrl: `https://docs.google.com/forms/d/e/${id}/viewform`,
    }
  }
  return null
}

const NOUN: Record<GovernedEmbedKind, string> = { video: 'video', map: 'map', form: 'form' }
const FRAME: Record<GovernedEmbedKind, string> = {
  video: 'display:block;width:100%;aspect-ratio:16/9;height:auto;border:0;border-radius:8px;background:#0f172a',
  map: 'display:block;width:100%;height:clamp(320px,55vh,520px);border:0;border-radius:8px;background:#f1f5f9',
  form: 'display:block;width:100%;height:clamp(560px,85vh,1100px);border:0;border-radius:8px;background:#fff',
}
const SANDBOX: Record<GovernedEmbedKind, string> = {
  video: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation',
  map: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
  form: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms',
}

/** A class a definition names for its own frame or placeholder (an imported V1 section's). */
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,100}$/

export type GovernedEmbedOptions = {
  preview?: boolean
  providerEmbeds?: boolean
  /** Shown where no provider frame may load (a preview, a library picture) while the field holds no accepted link. */
  empty?: string
  /**
   * The section's own frame classes (V1's `__iframe` and `__placeholder`).
   * With them the embed fills the section's frame as V1's did, instead of
   * bringing a frame and card of its own: the frame is the iframe, and the
   * hint and the editor's card are the section's placeholder.
   */
  frameClass?: string
  placeholderClass?: string
}

/**
 * The embed as the page shows it. In a preview (or wherever frames are not
 * allowed) it is an inert card naming the provider, so the editor can select
 * the section without a provider frame catching clicks. `empty` is shown there
 * when the field holds no accepted link; the public page then shows nothing at
 * all.
 */
export function renderGovernedEmbed(
  kind: GovernedEmbedKind,
  value: unknown,
  title: string,
  options: GovernedEmbedOptions = {},
): string {
  const embed = governedEmbed(kind, value)
  const label = title.trim() || `Embedded ${NOUN[kind]}`
  const frameClass = options.frameClass && CLASS_NAME.test(options.frameClass) ? options.frameClass : null
  const placeholderClass =
    frameClass && options.placeholderClass && CLASS_NAME.test(options.placeholderClass)
      ? options.placeholderClass
      : null
  const inert = options.preview === true || options.providerEmbeds === false
  if (!embed) {
    if (!inert || !options.empty) return ''
    return placeholderClass
      ? `<p class="${placeholderClass}">${escapeText(options.empty)}</p>`
      : `<p class="cms-governed-embed-empty" style="margin:0;padding:24px;border:1px dashed #94a3b8;border-radius:8px;color:#475569">${escapeText(options.empty)}</p>`
  }
  const open = `<a href="${escapeAttribute(embed.openUrl)}" target="_blank" rel="noopener noreferrer">Open the ${NOUN[kind]} on ${escapeText(embed.providerName)}</a>`
  const notice = `${escapeText(embed.providerName)} ${NOUN[kind]}. Visitors choose whether to load it on the public page.`
  if (inert) {
    // One span, so a placeholder that centres its content as a flex box keeps these lines together.
    if (placeholderClass)
      return `<p class="${placeholderClass}"><span><strong>${escapeText(label)}</strong><br>${notice}<br>${open}</span></p>`
    return (
      `<div class="cms-governed-embed" style="min-width:0;padding:24px;border:1px solid #cbd5e1;border-radius:8px"><strong>${escapeText(label)}</strong>` +
      `<p>${notice}</p><p>${open}</p></div>`
    )
  }
  // Filling a section's frame, the direct link has no room beside it, so the
  // notice offers it too.
  const consent =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>html,body{height:100%}body{font:15px/1.5 system-ui,sans-serif;color:#1e293b;background:#f8fafc;margin:0;padding:16px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center}' +
    'main{max-width:34rem}h2{font-size:1.125rem;margin:0 0 .5rem}p{margin:0 0 1rem}.actions{display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;align-items:center;justify-content:center}' +
    '.load{display:inline-block;background:#164e63;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none}.open{color:#164e63}a:focus-visible{outline:3px solid #0e7490;outline-offset:4px}</style></head><body><main>' +
    `<h2>${escapeText(label)}</h2><p>Loading this ${NOUN[kind]} connects to ${escapeText(embed.providerName)}, which may use cookies and receives your IP address.</p>` +
    `<div class="actions"><a class="load" href="${escapeAttribute(embed.embedUrl)}" target="_self" rel="noreferrer">Load the ${NOUN[kind]}</a>` +
    (frameClass
      ? `<a class="open" href="${escapeAttribute(embed.openUrl)}" target="_blank" rel="noopener noreferrer">Open it on ${escapeText(embed.providerName)}</a>`
      : '') +
    '</div></main></body></html>'
  const frame =
    `<iframe${frameClass ? ` class="${frameClass}"` : ''}${frameClass ? ` data-cms-embed-provider="${embed.provider}"` : ''} title="${escapeAttribute(label)}" srcdoc="${escapeAttribute(consent)}"` +
    ` sandbox="${SANDBOX[kind]}" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"` +
    `${frameClass ? '' : ` style="${FRAME[kind]}"`}></iframe>`
  if (frameClass) return frame
  return `<div class="cms-governed-embed" style="min-width:0" data-cms-embed-provider="${embed.provider}">${frame}<p style="font-size:.875rem">${open}</p></div>`
}

/** The frame sources a rendered public page needs, from the embeds it emitted. */
export function governedEmbedFrameSources(html: string): string[] {
  const providers = new Set(renderedFeatures(html).embedProviders)
  return Object.entries(GOVERNED_EMBED_FRAME_SOURCES)
    .filter(([provider]) => providers.has(provider))
    .map(([, source]) => source)
}
