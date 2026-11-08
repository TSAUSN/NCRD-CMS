import { renderEchelonDirectory } from './echelon-directory.ts'
import type { SiteWidget } from '@cms/schema'
import { escapeAttribute as attr, escapeText as text, safeUrl } from './escape.ts'
type ChapterDirectoryEntry = {
  name: string
  path?: string | null
  externalUrl?: string | null
  destination?: 'division'
}
export type SiteWidgetContext = {
  chapters?: unknown
  query?: string
  pagePath?: string
  contactSent?: boolean
  contactError?: string
  contactValues?: Record<string, string>
  contactStyle?: 'echelon'
  chapterDirectoryStyle?: 'echelon'
  widgetKey?: string
}
function search(context: SiteWidgetContext): string {
  return `<form class="cms-chapter-search" action="/chapters" method="get"><label>Find a chapter<input type="search" name="q" maxlength="120" value="${attr((context.query ?? '').slice(0, 120))}" placeholder="City or chapter name"></label><button class="cms-button" type="submit">Search</button></form>`
}
function directory(context: SiteWidgetContext): string {
  if (context.chapterDirectoryStyle === 'echelon') return renderEchelonDirectory(context)
  const query = (context.query ?? '').trim().toLocaleLowerCase('en-US').slice(0, 120)
  const entries = (Array.isArray(context.chapters) ? context.chapters : []).slice(0, 500).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as ChapterDirectoryEntry
    if (
      typeof row.name !== 'string' ||
      row.name.length > 160 ||
      !row.name.trim() ||
      (query && !row.name.toLocaleLowerCase('en-US').includes(query))
    )
      return []
    const external =
      typeof row.externalUrl === 'string' && row.externalUrl.startsWith('https://') ? safeUrl(row.externalUrl) : null
    const path = typeof row.path === 'string' && /^\/(?!\/)/.test(row.path) ? safeUrl(row.path) : null
    const href = external ?? path
    if (!href) return []
    return [
      `<li class="core-card"><h3>${text(row.name)}</h3><a href="${attr(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${external ? (row.destination === 'division' ? 'Visit their division’s page ↗' : 'Visit their website ↗') : 'View chapter'}</a></li>`,
    ]
  })
  return (
    search(context) +
    `<p role="status">${entries.length ? `${entries.length} ${entries.length === 1 ? 'chapter' : 'chapters'}${query ? ' found' : ''}` : query ? 'No chapters match your search. Try another name.' : 'Chapter pages will appear here when they are published.'}</p><ul class="cms-chapter-results">${entries.join('')}</ul>`
  )
}
const contactFields = [
  ['first_name', 'First name', 'text', 80],
  ['last_name', 'Last name', 'text', 80],
  ['email', 'Email', 'email', 254],
  ['phone', 'Phone', 'tel', 60],
  ['comments', 'Comments', 'textarea', 5000],
] as const
function contact(context: SiteWidgetContext): string {
  if (context.contactSent) return '<p role="status">Thank you. Your message has been saved.</p>'
  return `${context.contactError ? `<p role="alert">${text(context.contactError)}</p>` : ''}<form class="cms-contact-form" action="/__cms/contact" method="post"><input type="hidden" name="page" value="${attr(context.pagePath ?? '/')}">${contactFields.map(([name, label, type, max]) => `<label>${context.contactStyle === 'echelon' ? (name === 'comments' ? 'Message' : label) : label + ' <span>(required)</span>'}${type === 'textarea' ? `<textarea name="${name}" maxlength="${max}"${context.contactStyle === 'echelon' ? ' placeholder="How can we help?"' : ''} required>${text((context.contactValues?.[name] ?? '').slice(0, max))}</textarea>` : `<input type="${type}" name="${name}" maxlength="${max}" autocomplete="${name === 'first_name' ? 'given-name' : name === 'last_name' ? 'family-name' : type}" value="${attr((context.contactValues?.[name] ?? '').slice(0, max))}"${context.contactStyle === 'echelon' ? ' placeholder="' + attr(name === 'email' ? 'you@example.com' : name === 'phone' ? '(555) 123-4567' : label) + '"' : ''} required>`}</label>`).join('')}<div class="cms-contact-honey" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div><button class="cms-button" type="submit">Send message</button></form>`
}
export function renderSiteWidget(widget: SiteWidget, context: SiteWidgetContext = {}): string {
  return `<div class="cms-site-widget" data-cms-site-widget="${widget}">${widget === 'site-search' ? '<form class="cms-site-search" action="/newsroom" method="get" role="search"><input name="q" type="search" aria-label="Site search" placeholder="Site Search" maxlength="120"><button type="submit">Search</button></form>' : widget === 'chapter-search' ? search(context) : widget === 'chapter-directory' ? directory(context) : contact(context)}</div>`
}
/** Site theme roles only. Emitted only on pages using a closed widget. */
export const SITE_WIDGET_CSS = [
  '.cms-site-widget label{display:grid;gap:.5rem;font-weight:600}',
  '.cms-site-widget input,.cms-site-widget textarea{box-sizing:border-box;width:100%;min-width:0;min-height:2.75rem;padding:.75rem;font:inherit;color:var(--color-ink);background:var(--color-surface);border:1px solid var(--color-muted);border-radius:var(--button-radius)}',
  '.cms-site-widget :is(input,textarea,button,a):focus-visible{outline:2px solid var(--color-primary);outline-offset:.25rem}',
  '.cms-chapter-search{display:flex;align-items:end;flex-wrap:wrap;gap:1rem;margin-block:1rem 1.5rem}',
  '.cms-chapter-search label{flex:1 1 15rem}',
  '.cms-chapter-search button,.cms-contact-form button{min-height:2.75rem;cursor:pointer;font:inherit}',
  '.cms-chapter-results{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:1rem}',
  '.cms-chapter-results li{margin:0}',
  '.cms-contact-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem}',
  '.cms-contact-form label:has(textarea){grid-column:1/-1}',
  '.cms-contact-form textarea{min-height:9rem;resize:vertical}',
  '.cms-contact-form button{justify-self:start}',
  '.cms-contact-form label>span{font-size:.875rem;font-weight:400}',
  '.cms-contact-honey{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}',
  '@media(max-width:47.99em){.cms-contact-form{grid-template-columns:1fr}',
  '.cms-chapter-search button{width:100%}',
  '}',
].join('')
