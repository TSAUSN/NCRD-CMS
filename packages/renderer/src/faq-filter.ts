import { renderedFeatures } from './feature-markers.ts'
import { sha256Base64 } from './sha256.ts'

/**
 * Enable the marked FAQ search and filter questions inside the same section. It stays disabled
 * without JavaScript. The markers identify the input, empty state and clear button; they carry no
 * authored code or URLs. Only pages with the marker get this runtime and its script hash.
 */
export const FAQ_FILTER_RUNTIME = `(function(){"use strict";document.querySelectorAll("input[data-cms-faq-filter]").forEach(function(input){var scope=input.closest(".cms-section")||document,items=scope.querySelectorAll(".faq-item"),empty=scope.querySelector("[data-cms-faq-empty]"),clear=scope.querySelector("[data-cms-faq-clear]");function apply(){var query=input.value.trim().toLowerCase(),shown=0;items.forEach(function(item){var match=!query||item.textContent.toLowerCase().indexOf(query)!==-1;item.style.display=match?"":"none";if(match)shown++;});if(empty)empty.hidden=shown!==0;}input.disabled=false;input.addEventListener("input",apply);if(clear){clear.disabled=false;clear.addEventListener("click",function(){input.value="";apply();input.focus();});}});})();`

export function faqFilterScriptHash(): string {
  return 'sha256-' + sha256Base64(FAQ_FILTER_RUNTIME)
}

/** Whether rendered page markup carries a governed FAQ filter. */
export function hasFaqFilter(html: string): boolean {
  return renderedFeatures(html).faqFilter
}
