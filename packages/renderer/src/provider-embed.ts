import { sha256Base64 } from './sha256.ts'
import { TableauEmbed } from '@cms/schema'
import { escapeAttribute, escapeText } from './escape.ts'

export const TABLEAU_FRAME_SOURCE = 'https://public.tableau.com'
export function tableauEmbedUrl(value: unknown): string | null {
  const parsed = TableauEmbed.safeParse(value)
  if (!parsed.success) return null
  return `${TABLEAU_FRAME_SOURCE}/views/${parsed.data.workbook}/${parsed.data.view}?:embed=yes&:showVizHome=no&:toolbar=yes&:animate_transition=yes&:display_static_image=no&:display_spinner=no`
}

/**
 * The chart frame's default size and border, in the page shell rather than on
 * the frame. `:where` gives it no specificity, so a section's own frame rule
 * decides when it has one, as it did in the source: HNI's V1 charts set
 * `.tableau-wrapper--timeline iframe{height:560px;border:none}` inside a frame
 * drawn at 85%.
 */
export const PROVIDER_FRAME_CSS =
  ':where(.cms-provider-embed iframe){display:block;width:100%;height:clamp(440px,80vh,900px);min-width:0;border:1px solid #cbd5e1;border-radius:8px;background:#fff}'

/**
 * Consent uses a code-owned srcdoc link: the browser contacts Tableau only
 * after an explicit click, without adding scripts to the public CMS document.
 * After navigation Tableau owns the visualization. A small hash-authorized
 * parent runtime implements only the optional native fullscreen control.
 * No top navigation, camera or location is granted.
 */
export function renderProviderEmbed(
  value: unknown,
  options: { preview?: boolean; providerEmbeds?: boolean } = {},
): string | null {
  const parsed = TableauEmbed.safeParse(value)
  const url = tableauEmbedUrl(value)
  if (!parsed.success || !url) return null
  const title = escapeText(parsed.data.title)
  const fallback = `<p><a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">Open larger on Tableau</a></p>`
  const notice =
    '<p>Loading this chart connects to Tableau Public, which may use cookies and receives your IP address. The chart’s data and controls are provided by Tableau.</p>'
  if (options.preview || options.providerEmbeds === false) {
    return (
      `<div class="cms-provider-embed" style="min-width:0;padding:24px;border:1px solid #cbd5e1;border-radius:8px"><strong>${title}</strong>` +
      '<p>Interactive Tableau chart. Visitors choose whether to load it on the public page. ' +
      (options.preview
        ? 'Select this section to edit its surrounding content; the chart configuration is managed by an administrator.'
        : 'This preview does not connect to Tableau.') +
      '</p>' +
      fallback +
      '</div>'
    )
  }
  const consent =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px/1.6 system-ui,sans-serif;color:#1e293b;background:#f8fafc;margin:0;padding:24px;box-sizing:border-box}main{max-width:38rem;margin:8vh auto}a{display:inline-block;background:#164e63;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none}a:focus-visible{outline:3px solid #0e7490;outline-offset:4px}</style></head><body><main>' +
    `<h2>${title}</h2>${notice}<a href="${escapeAttribute(url)}" target="_self" rel="noreferrer">Load interactive chart</a>` +
    '<p>You can also use the link below this frame to open the chart directly. Use the Fullscreen chart button outside this frame for a larger view.</p></main></body></html>'
  return (
    `<div class="cms-provider-embed" style="min-width:0"><iframe title="${escapeAttribute(parsed.data.title)}" srcdoc="${escapeAttribute(consent)}"` +
    ` sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" allow="fullscreen" allowfullscreen referrerpolicy="no-referrer" loading="lazy"></iframe>` +
    '<button type="button" data-cms-provider-fullscreen hidden style="margin-top:12px;padding:10px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#164e63">Fullscreen chart</button><span data-cms-provider-status role="status"></span>' +
    fallback +
    '<p style="font-size:.875rem">If the chart cannot load, open it on Tableau. Dates and data coverage are shown by the source visualization.</p></div>'
  )
}

/** Constant bytes; no authored values or provider messages are evaluated. */
export const PROVIDER_EMBED_RUNTIME = `(function(){"use strict";document.querySelectorAll("[data-cms-provider-fullscreen]").forEach(function(button){var block=button.closest(".cms-provider-embed"),frame=block&&block.querySelector("iframe"),status=block&&block.querySelector("[data-cms-provider-status]");if(!frame||!frame.requestFullscreen)return;button.hidden=false;button.addEventListener("click",function(){frame.requestFullscreen().catch(function(){if(status)status.textContent=" Fullscreen is unavailable. Open the chart on Tableau instead.";});});});})();`
export function providerEmbedScriptHash(): string {
  return 'sha256-' + sha256Base64(PROVIDER_EMBED_RUNTIME)
}
