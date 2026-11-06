import { renderedFeatures } from './feature-markers.ts'
import { sha256Base64 } from './sha256.ts'
/** Extends the existing native Menu layout using the loaded font's actual width. */
export const NATIONAL_NAVIGATION_RUNTIME = `(function(){"use strict";
 document.querySelectorAll('.cms-frame--header:has(.national-header-row)').forEach(function(header){
  var row=header.querySelector('.national-header-row'),nav=row&&row.querySelector('.national-desktop-nav'),menu=row&&row.querySelector('.national-phone-menu');
  if(!row||!nav||!menu||header.hasAttribute('data-cms-nav-measured'))return;
  header.setAttribute('data-cms-nav-measured','');var frame=0;
  function measure(){
   frame=0;var probe=nav.cloneNode(true);probe.setAttribute('aria-hidden','true');probe.inert=true;
   probe.style.cssText='display:flex!important;position:fixed!important;visibility:hidden!important;pointer-events:none!important;width:max-content!important;max-width:none!important;flex:none!important;';
   row.appendChild(probe);var required=probe.getBoundingClientRect().width;probe.remove();
   var style=getComputedStyle(row),parts=Array.from(row.children).filter(function(node){return node!==nav&&node!==menu&&getComputedStyle(node).display!=='none';});
   parts.forEach(function(node){required+=node.getBoundingClientRect().width;});
   required+=(parseFloat(style.columnGap)||0)*parts.length+(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
   var fits=window.innerWidth>=1200&&required<=row.clientWidth-1,was=header.getAttribute('data-cms-nav-fit'),next=fits&&!menu.open?'wide':'compact';
   if(next!==was){var focused=nav.contains(document.activeElement);header.setAttribute('data-cms-nav-fit',next);if(next==='compact'&&focused)menu.querySelector('summary').focus({preventScroll:true});}
  }
  function update(){if(!frame)frame=requestAnimationFrame(measure);}
  new ResizeObserver(update).observe(row);
  new MutationObserver(update).observe(nav,{subtree:true,childList:true,characterData:true});
  menu.addEventListener('toggle',function(event){if(event.target===menu)update();});
  window.addEventListener('resize',update);
  if(document.fonts){document.fonts.ready.then(update);document.fonts.addEventListener('loadingdone',update);}
  measure();
 });
})();`
export const nationalNavigationScriptHash = () => 'sha256-' + sha256Base64(NATIONAL_NAVIGATION_RUNTIME)
export const hasNationalNavigation = (html: string) => renderedFeatures(html).nationalNavigation
