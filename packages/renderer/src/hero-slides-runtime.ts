import { renderedFeatures } from './feature-markers.ts'
import { HERO_WINDOW_RUNTIME } from './hero-window-runtime.ts'
import { sha256Base64 } from './sha256.ts'
export const HERO_SLIDES_RUNTIME = `(function(){"use strict";
 ${HERO_WINDOW_RUNTIME}
 document.querySelectorAll('[data-cms-hero]').forEach(function(track){
  if(track.hasAttribute('data-cms-hero-ready'))return;track.setAttribute('data-cms-hero-ready','');
  if(track.hasAttribute('data-cms-hero-windowed')){windowedHero(track);return;}
  var slides=Array.from(track.children).filter(function(node){return node.classList.contains('cms-hero-slide');});if(slides.length<2)return;
  var active=0,hover=false,focused=false,editing=track.hasAttribute('data-cms-hero-editing'),timer=null,scrolled=null,reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  function position(slide){return slide.getBoundingClientRect().left-track.getBoundingClientRect().left+track.scrollLeft;}
  function mark(index){active=Math.max(0,Math.min(slides.length-1,index));slides.forEach(function(slide,n){slide.inert=n!==active;slide.querySelectorAll('[data-cms-hero-control="dot"]').forEach(function(dot){if(Number(dot.getAttribute('data-cms-hero-target'))===active)dot.setAttribute('aria-current','true');else dot.removeAttribute('aria-current');});});}
  function stop(){if(timer!==null)window.clearInterval(timer);timer=null;}
  function start(){stop();if(hover||focused||editing||reduced.matches||document.hidden)return;timer=window.setInterval(function(){go((active+1)%slides.length);},6000);}
  function go(index,control){var hadFocus=track.contains(document.activeElement);mark(index);track.scrollTo({left:position(slides[active]),behavior:reduced.matches?'instant':'smooth'});if(control&&hadFocus){var selector='[data-cms-hero-control="'+control+'"]'+(control==='dot'?'[data-cms-hero-target="'+active+'"]':'');var next=slides[active].querySelector(selector);if(next)next.focus({preventScroll:true});}if(editing&&control)track.dispatchEvent(new CustomEvent('cms:hero-navigate',{bubbles:true,detail:{key:slides[active].getAttribute('data-cms-hero-key')}}));}
  track.addEventListener('click',function(event){var anchor=event.target.closest&&event.target.closest('[data-cms-hero-target]');if(!anchor||!track.contains(anchor))return;event.preventDefault();var index=Number(anchor.getAttribute('data-cms-hero-target'));if(!Number.isSafeInteger(index)||index<0||index>=slides.length)return;go(index,anchor.getAttribute('data-cms-hero-control'));start();});
  track.addEventListener('mouseenter',function(){hover=true;stop();});track.addEventListener('mouseleave',function(){hover=false;start();});
  track.addEventListener('focusin',function(){focused=true;stop();});track.addEventListener('focusout',function(){window.setTimeout(function(){focused=track.contains(document.activeElement);start();},0);});
  track.addEventListener('scroll',function(){if(scrolled!==null)window.clearTimeout(scrolled);scrolled=window.setTimeout(function(){var left=track.scrollLeft,nearest=0,distance=Infinity;slides.forEach(function(slide,n){var next=Math.abs(position(slide)-left);if(next<distance){nearest=n;distance=next;}});mark(nearest);},120);},{passive:true});
  track.addEventListener('cms:hero-select',function(event){var index=slides.findIndex(function(slide){return event.detail&&slide.getAttribute('data-cms-hero-key')===event.detail.key;});if(index>=0){editing=true;stop();go(index);}});
  window.addEventListener('resize',function(){track.scrollTo({left:position(slides[active]),behavior:'instant'});});
  document.addEventListener('visibilitychange',start);reduced.addEventListener('change',start);mark(0);start();
 });
})();`
export const heroSlidesScriptHash = () => 'sha256-' + sha256Base64(HERO_SLIDES_RUNTIME)
export const hasHeroSlides = (html: string) => renderedFeatures(html).heroSlides
