import { renderedFeatures } from './feature-markers.ts'
import { sha256Base64 } from './sha256.ts'

/**
 * V1's FAQ search as a fixed, code-owned filter (HNI Resources, D3).
 *
 * The importer marks V1's search box `data-cms-faq-filter` and leaves it
 * disabled, so without JavaScript the page is honest: a box that cannot be
 * used looks unusable. This runtime enables it and, within the box's own
 * section only, shows the questions whose words contain what the visitor
 * typed, as V1's `initFaqSearch` did. V1's “no questions match” line
 * (`data-cms-faq-empty`) appears when nothing matches, and its “clear the
 * filter” button (`data-cms-faq-clear`) empties the box. It reads no authored
 * code, URLs or messages: the markers only say which box filters which
 * questions. Public pages that carry a marked box get this script and its
 * exact SHA-256 allowance; every other page stays script-free.
 */
export const FAQ_FILTER_RUNTIME = `(function(){"use strict";document.querySelectorAll("input[data-cms-faq-filter]").forEach(function(input){var scope=input.closest(".cms-section")||document,items=scope.querySelectorAll(".faq-item"),empty=scope.querySelector("[data-cms-faq-empty]"),clear=scope.querySelector("[data-cms-faq-clear]");function apply(){var query=input.value.trim().toLowerCase(),shown=0;items.forEach(function(item){var match=!query||item.textContent.toLowerCase().indexOf(query)!==-1;item.style.display=match?"":"none";if(match)shown++;});if(empty)empty.hidden=shown!==0;}input.disabled=false;input.addEventListener("input",apply);if(clear){clear.disabled=false;clear.addEventListener("click",function(){input.value="";apply();input.focus();});}});})();`

export function faqFilterScriptHash(): string {
  return 'sha256-' + sha256Base64(FAQ_FILTER_RUNTIME)
}

/** Whether rendered page markup carries a governed FAQ filter. */
export function hasFaqFilter(html: string): boolean {
  return renderedFeatures(html).faqFilter
}
