import { renderedFeatures } from './feature-markers.ts'
import { sha256Base64 } from './sha256.ts'
/** Fixed progressive enhancement: all sessions remain readable without JavaScript. */
export const SCHEDULE_FILTER_RUNTIME = `(function(){"use strict";document.querySelectorAll("[data-cms-track-filter]").forEach(function(bar){var scope=bar.parentElement;if(!scope)return;var buttons=bar.querySelectorAll("button[data-cms-track-value]");function apply(track){scope.querySelectorAll("[data-cms-session-track]").forEach(function(item){item.hidden=!!track&&item.getAttribute("data-cms-session-track")!==track;});scope.querySelectorAll(".cms-list-day").forEach(function(day){day.hidden=!Array.from(day.querySelectorAll("[data-cms-session-track]")).some(function(item){return !item.hidden;});});buttons.forEach(function(button){button.setAttribute("aria-pressed",String(button.getAttribute("data-cms-track-value")===track));});}buttons.forEach(function(button){button.disabled=false;button.addEventListener("click",function(){apply(button.getAttribute("data-cms-track-value")||"");});});bar.hidden=false;});})();`
export function scheduleFilterScriptHash(): string {
  return 'sha256-' + sha256Base64(SCHEDULE_FILTER_RUNTIME)
}
export function hasScheduleFilter(html: string): boolean {
  return renderedFeatures(html).scheduleFilter
}
