import { HERO_SLIDES_RUNTIME } from './hero-slides-runtime.ts'
import { sha256Base64 } from './sha256.ts'

// The canvas runtime.
//
// It lives in the renderer because the renderer owns the `data-cms-*` contract
// it reads. It is injected **only** when `preview: true`, so nothing here can
// reach a published page. Public pages carry only the fixed, hash-allowed
// runtimes they need (see apps/site/src/lib/public-security.ts).
//
// The canvas talks to its authenticated editor over one server-chosen origin. Its keyboard events do not bubble to the editor, so history
// requests travel over the same checked bridge as field edits.

export { PREVIEW_MESSAGE } from './preview-messages.ts'
import { PREVIEW_MESSAGE } from './preview-messages.ts'

export const PREVIEW_RUNTIME = `(() => {
  const parentWindow = window.parent;
  if (parentWindow === window) return;

  let selected = null;
  let frameEditing = null;

  const parentOrigin = document.documentElement.getAttribute('data-cms-parent-origin') || window.location.origin;
  const channel = document.documentElement.getAttribute('data-cms-channel') || null;
  const post = (type, detail) => parentWindow.postMessage({ type, ...detail, ...(channel ? { channel, documentId } : {}) }, parentOrigin);
  const documentId = String(Date.now()) + ':' + String(Math.random());
  if (channel) document.documentElement.setAttribute('data-cms-document', documentId);
  const announceReady = (requestId) => post('${PREVIEW_MESSAGE.ready}', { documentId, ...(typeof requestId === 'string' && /^[a-z0-9-]{1,80}$/i.test(requestId) ? { requestId } : {}) });

  // As V1's editor did, a registration call to action whose link is still a
  // placeholder ("#register") is shown on the canvas so it can be selected and
  // given a real destination. The published page keeps it hidden until then.
  for (const link of document.querySelectorAll('a[data-registration-cta].registration-unavailable')) {
    link.classList.remove('registration-unavailable');
    link.setAttribute('data-cms-registration-pending', '');
    if (!link.hasAttribute('title')) link.setAttribute('title', 'Hidden on the published page until it links to a registration address');
  }

  const slotAt = (target) => target && target.closest ? target.closest('[data-cms-slot]') : null;
  const sectionAt = (target) => target && target.closest ? target.closest('[data-cms-section]') : null;
  const occurrences = (section, slot) => [...section.querySelectorAll('[data-cms-slot]')]
    .filter(node => node.getAttribute('data-cms-slot') === slot.getAttribute('data-cms-slot'));
  const selectionAt = (section, slot) => ({
    section: Number(section.getAttribute('data-cms-section')),
    slot: slot ? slot.getAttribute('data-cms-slot') : null,
    occurrence: slot ? occurrences(section, slot).indexOf(slot) : 0,
  });

  // A selected field that wraps across lines is framed as one box, as V1 did,
  // instead of one outline per line fragment ("Human" / "Needs" / "Index").
  // Only an element with two or more line boxes is marked, so a boxless link or
  // image wrapper (no client rects at all) never is.
  const frameSelection = () => {
    for (const node of document.querySelectorAll('[data-cms-multiline]')) node.removeAttribute('data-cms-multiline');
    const node = selected && selected.slot ? document.querySelector('[data-cms-slot][data-cms-selected]') : null;
    const rects = node ? [...node.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0) : [];
    let frame = document.querySelector('cms-selection-frame');
    if (rects.length < 2) { if (frame) frame.remove(); return; }
    node.setAttribute('data-cms-multiline', '');
    if (!frame) {
      frame = document.createElement('cms-selection-frame');
      frame.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(frame);
    }
    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    frame.style.left = (left + window.scrollX) + 'px';
    frame.style.top = (top + window.scrollY) + 'px';
    frame.style.width = (Math.max(...rects.map(rect => rect.right)) - left) + 'px';
    frame.style.height = (Math.max(...rects.map(rect => rect.bottom)) - top) + 'px';
  };

  const paint = () => {
    for (const node of document.querySelectorAll('[data-cms-selected],[data-cms-selected-within]')) {
      node.removeAttribute('data-cms-selected');
      node.removeAttribute('data-cms-selected-within');
    }
    frameSelection();
    if (!selected) return;
    const selector = selected.slot
      ? '[data-cms-section="' + selected.section + '"] [data-cms-slot="' + selected.slot + '"]'
      : '[data-cms-section="' + selected.section + '"]';
    const node = document.querySelectorAll(selector)[selected.occurrence || 0];
    if (node) {
      node.setAttribute('data-cms-selected', '');
      // A selected field keeps its section's boundary and name visible, so the
      // author sees where the change lands without relying on colour alone.
      const within = selected.slot ? node.closest('[data-cms-section]') : null;
      if (within) within.setAttribute('data-cms-selected-within', '');
      // Scroll something that has a box. A link or an image slot's wrapper is
      // \`display:contents\` so that its child, rather than the wrapper, is the
      // flex or grid item — and an element with no box has an empty client-rect
      // list, which makes scrollIntoView on it a silent no-op. Selecting a link
      // from the structure tree then outlined it and never brought it on
      // screen. Asked of the rects rather than of the kind, so a future kind
      // that becomes boxless is covered without this remembering to.
      const scrollable = node.getClientRects().length === 0 && node.firstElementChild
        ? node.firstElementChild : node;
      scrollable.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    frameSelection();
  };
  // The frame follows the field as it is typed into, as fonts and pictures
  // arrive, and as the preview width changes.
  document.addEventListener('input', frameSelection, true);
  window.addEventListener('resize', frameSelection);
  if (typeof ResizeObserver === 'function') new ResizeObserver(frameSelection).observe(document.documentElement);
  if (document.fonts) document.fonts.ready.then(frameSelection);

  const requestRichText = (slot, section, event) => {
    for (const node of document.querySelectorAll('[contenteditable="plaintext-only"]')) node.removeAttribute('contenteditable');
    selected = selectionAt(section, slot);
    paint();
    post('${PREVIEW_MESSAGE.editRichText}', {
      ...selected,
      x: event && Number.isFinite(event.clientX) ? event.clientX : null,
      y: event && Number.isFinite(event.clientY) ? event.clientY : null,
    });
  };
  const editPlainText = (slot, event) => {
    if (slot.getAttribute('data-cms-kind') !== 'text') return;
    slot.setAttribute('contenteditable', 'plaintext-only');
    for (const other of document.querySelectorAll('[contenteditable="plaintext-only"]')) {
      if (other !== slot) other.removeAttribute('contenteditable');
    }
    slot.focus({ preventScroll: true });
    let range = null;
    if (event && document.caretPositionFromPoint) {
      const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
      if (caret && slot.contains(caret.offsetNode)) {
        range = document.createRange();
        range.setStart(caret.offsetNode, caret.offset);
        range.collapse(true);
      }
    } else if (event && document.caretRangeFromPoint) {
      const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (caret && slot.contains(caret.startContainer)) range = caret;
    }
    // Keyboard activation and clicks in empty padding stay inside this field.
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(slot);
      range.collapse(false);
    }
    const selection = document.getSelection();
    if (selection) { selection.removeAllRanges(); selection.addRange(range); }
  };
  // Preview-only keyboard entry points; these never occur in public output.
  for (const node of document.querySelectorAll('[data-cms-kind="text"],[data-cms-kind="richtext"]')) {
    if (node.hasAttribute('data-cms-slot')) node.setAttribute('tabindex', '0');
  }

  document.addEventListener('dragstart',event=>{const item=event.target.closest&&event.target.closest('[data-cms-menu-path]');if(!frameEditing||!item)return;event.dataTransfer.setData('application/x-cms-menu',item.getAttribute('data-cms-menu-path'));});
  document.addEventListener('dragover',event=>{if(frameEditing&&event.target.closest&&event.target.closest('[data-cms-menu-path]')&&event.dataTransfer.types.includes('application/x-cms-menu'))event.preventDefault();});
  document.addEventListener('drop',event=>{const item=event.target.closest&&event.target.closest('[data-cms-menu-path]');if(!frameEditing||!item)return;const from=event.dataTransfer.getData('application/x-cms-menu');if(!from)return;event.preventDefault();post('${PREVIEW_MESSAGE.moveFrameMenu}',{from,to:item.getAttribute('data-cms-menu-path')});});
  document.addEventListener('cms:hero-navigate', (event) => {
    const track=event.target;
    if(!(track instanceof Element)||!track.hasAttribute('data-cms-hero-editing'))return;
    const slide=[...track.children].find(node=>node.getAttribute('data-cms-hero-key')===(event.detail&&event.detail.key));
    const field=slide&&(slide.querySelector('[data-cms-kind="image"][data-cms-slot]')||slide.querySelector('[data-cms-slot]'));
    const section=sectionAt(track);
    if(!field||!section)return;
    selected=selectionAt(section,field);paint();post('${PREVIEW_MESSAGE.select}',selected);
  });
  document.addEventListener('click', (event) => {
    if(event.target.closest&&event.target.closest('[data-cms-editor-ghost],[data-cms-editor-list-ghost],[data-cms-menu-add]'))return;
    if(event.target.closest&&event.target.closest('.cms-hero-controls'))return;
    const frame = event.target.closest && event.target.closest('[data-cms-frame]');
    if (frame) {
      const menuItem = event.target.closest('[data-cms-menu-path]');
      if (frameEditing === frame.getAttribute('data-cms-frame') && menuItem) {
        event.preventDefault(); menuItem.setAttribute('contenteditable','plaintext-only'); menuItem.focus();
        const range = document.createRange(); range.selectNodeContents(menuItem); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
      }
      if (event.target.closest('summary')) return;
      event.preventDefault(); post('${PREVIEW_MESSAGE.selectFrame}', { part: frame.getAttribute('data-cms-frame') }); return;
    }
    if (frameEditing) { event.preventDefault(); return; }
    const slot = slotAt(event.target);
    const section = sectionAt(event.target);
    const item = event.target.closest && event.target.closest('[data-cms-entry]');
    if (item && section) { event.preventDefault(); selected = selectionAt(section, null); paint(); post('${PREVIEW_MESSAGE.selectListItem}', { section: selected.section, readerKey: item.getAttribute('data-cms-reader'), stableKey: item.getAttribute('data-cms-entry'), field: item.getAttribute('data-cms-list-field') }); return; }
    if (!section) return;
    // TipTap owns selection/caret behavior inside its mounted rich-text view.
    if (slot && slot.hasAttribute('data-cms-inline-editing')) return;
    // Once active, native pointer selection owns the caret. Repositioning here
    // would collapse every drag-selected phrase when the click event arrives.
    if (slot && slot.getAttribute('contenteditable') === 'plaintext-only') return;
    event.preventDefault();

    const next = selectionAt(section, slot);

    // Second click on an already-selected text slot puts a caret in it —
    // v1's behaviour, kept (SPEC §6.4).
    const same = selected && selected.section === next.section && selected.slot === next.slot && selected.occurrence === next.occurrence;
    if (same && slot && slot.getAttribute('data-cms-kind') === 'text') {
      editPlainText(slot, event);
      return;
    }

    if (same && slot && slot.getAttribute('data-cms-kind') === 'richtext') {
      requestRichText(slot, section, event);
      return;
    }

    for (const node of document.querySelectorAll('[contenteditable="plaintext-only"]')) {
      node.removeAttribute('contenteditable');
    }
    selected = next;
    paint();
    post('${PREVIEW_MESSAGE.select}', next);
    if (slot && slot.hasAttribute('tabindex')) slot.focus({ preventScroll: true });
  }, true);

  // Dragging a card from the docked library onto the page (V1 reference 10).
  // The gap is worked out from this document's own section boxes, so it is
  // right at any zoom: the pointer and the boxes share one coordinate space.
  const DRAG_TYPE = 'application/x-cms-section';
  const carriesSection = (event) => Boolean(event.dataTransfer)
    && Array.prototype.indexOf.call(event.dataTransfer.types, DRAG_TYPE) !== -1;
  const topSections = () => [...document.querySelectorAll('[data-cms-section]')]
    .filter(node => !(node.parentElement && node.parentElement.closest('[data-cms-section]')));
  const gapAt = (y) => {
    const sections = topSections();
    for (const node of sections) {
      const box = node.getBoundingClientRect();
      if (y < box.top + box.height / 2) return { at: Number(node.getAttribute('data-cms-section')), edge: box.top };
    }
    const last = sections[sections.length - 1];
    return last
      ? { at: Number(last.getAttribute('data-cms-section')) + 1, edge: last.getBoundingClientRect().bottom }
      : { at: 0, edge: 0 };
  };
  let dropLine = null;
  const showDropLine = (edge) => {
    if (!dropLine) {
      dropLine = document.createElement('div');
      dropLine.setAttribute('aria-hidden', 'true');
      dropLine.setAttribute('data-cms-drop-line', '');
      const label = document.createElement('span');
      label.textContent = 'Drop here';
      dropLine.appendChild(label);
      Object.assign(dropLine.style, { position: 'fixed', left: '0', right: '0', height: '4px', marginTop: '-2px',
        background: '#cf1f2a', zIndex: '2147483647', pointerEvents: 'none', boxShadow: '0 0 0 2px rgba(255,255,255,.85)' });
      Object.assign(label.style, { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        background: '#cf1f2a', color: '#fff', font: '600 13px/1.2 system-ui,-apple-system,sans-serif',
        padding: '4px 12px', borderRadius: '999px', whiteSpace: 'nowrap' });
      document.documentElement.appendChild(dropLine);
    }
    dropLine.style.top = Math.max(2, Math.min(window.innerHeight - 2, edge)) + 'px';
  };
  const hideDropLine = () => { if (dropLine) { dropLine.remove(); dropLine = null; } };
  document.addEventListener('dragover', (event) => {
    if (!carriesSection(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    showDropLine(gapAt(event.clientY).edge);
  });
  document.addEventListener('dragleave', (event) => { if (!event.relatedTarget) hideDropLine(); });
  document.addEventListener('dragend', hideDropLine);
  document.addEventListener('drop', (event) => {
    if (!carriesSection(event)) return;
    event.preventDefault();
    const id = event.dataTransfer.getData(DRAG_TYPE);
    const gap = gapAt(event.clientY);
    hideDropLine();
    if (id) post('${PREVIEW_MESSAGE.dropSection}', { sectionDefId: id, at: gap.at });
  });

  // A burst of typing is one undo step in the editor (V1 reference 05).
  // Clicking, or moving the caret or the selection, starts the next burst.
  let burst = 1;
  const nextBurst = () => { burst += 1; };
  document.addEventListener('pointerdown', nextBurst, true);
  document.addEventListener('click', nextBurst, true);
  document.addEventListener('keydown', (event) => {
    if (/^(Arrow|Home$|End$|Page)/.test(event.key) || ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'a')) nextBurst();
  }, true);

  document.addEventListener('input', (event) => {
    const menuItem = event.target.closest && event.target.closest('[data-cms-menu-path][contenteditable]');
    if (frameEditing && menuItem) { post('${PREVIEW_MESSAGE.editFrameMenu}', { path: menuItem.getAttribute('data-cms-menu-path'), label: menuItem.textContent }); return; }
    const slot = slotAt(event.target);
    const section = sectionAt(event.target);
    if (!slot || !section || slot.getAttribute('data-cms-kind') !== 'text' || !slot.hasAttribute('contenteditable')) return;
    // One field may be intentionally printed twice. Keep the passive copy in
    // sync without replacing the DOM node that owns the active caret.
    for (const other of occurrences(section, slot)) {
      if (other !== slot && other.getAttribute('data-cms-kind') === 'text') other.textContent = slot.textContent;
    }
    post('${PREVIEW_MESSAGE.edit}', {
      section: Number(section.getAttribute('data-cms-section')),
      slot: slot.getAttribute('data-cms-slot'),
      value: slot.textContent,
      burst,
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.target.closest && event.target.closest('[data-cms-menu-path][contenteditable]')) return;
    const slot = slotAt(event.target);
    const section = sectionAt(event.target);
    if (event.key === 'Enter' && slot && section && slot.getAttribute('data-cms-kind') === 'text'
      && !slot.hasAttribute('contenteditable')) {
      event.preventDefault();
      selected = selectionAt(section, slot);
      paint();
      post('${PREVIEW_MESSAGE.select}', { ...selected, editing: true });
      editPlainText(slot, null);
      return;
    }
    if (event.key === 'Enter' && slot && section && slot.getAttribute('data-cms-kind') === 'richtext'
      && !slot.hasAttribute('data-cms-inline-editing')) {
      event.preventDefault();
      requestRichText(slot, section, null);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      // Prevent a second, browser-local undo stack from changing the canvas
      // independently of the page document and inspector.
      event.preventDefault();
      post(event.shiftKey ? '${PREVIEW_MESSAGE.redo}' : '${PREVIEW_MESSAGE.undo}', {});
      return;
    }
    if (event.key !== 'Escape') return;
    for (const node of document.querySelectorAll('[contenteditable="plaintext-only"]')) {
      node.removeAttribute('contenteditable');
    }
    selected = null;
    paint();
    post('${PREVIEW_MESSAGE.select}', { section: null, slot: null });
  });

  // Browser Edit menus and touch history gestures may produce beforeinput
  // without a keyboard shortcut. Use the same owner for those edits too.
  document.addEventListener('beforeinput', (event) => {
    if (event.isComposing || !event.cancelable || event.target.closest && event.target.closest('[data-cms-menu-path][contenteditable]')) return;
    if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
    event.preventDefault();
    post(event.inputType === 'historyRedo' ? '${PREVIEW_MESSAGE.redo}' : '${PREVIEW_MESSAGE.undo}', {});
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== parentOrigin || event.source !== parentWindow || !event.data || (channel && event.data.channel !== channel)) return;
    const data = event.data;
    if (channel && data.type !== '${PREVIEW_MESSAGE.requestReady}' && data.documentId !== documentId) return;

    if (data.type === '${PREVIEW_MESSAGE.requestReady}') {
      announceReady(data.requestId);
      return;
    }

    if (data.type === '${PREVIEW_MESSAGE.cancelDrop}') {
      hideDropLine();
      return;
    }

    if (data.type === '${PREVIEW_MESSAGE.setValue}') {
      const nodes = [...document.querySelectorAll(
        '[data-cms-section="' + data.section + '"] [data-cms-slot="' + data.slot + '"]')];
      // Typing in the inspector updates the canvas without a round trip, and
      // only a text field can be updated that way: its rendered form is its
      // stored string. Rich text is what the sanitizer made of it and a link
      // or an image is the renderer's URL policy, so working out what those
      // should look like here would be a second renderer in the browser.
      // The parent uses its shared rich-text model/sanitizer or a fresh render
      // for those kinds; this answers so it knows a plain patch did not apply.
      // Financial amounts also determine charts;use the existing fresh-render path.
      const financialAmount = /^(?:expenses|revenue)__[a-z][a-z0-9]{0,7}__amount$/.test(data.slot)
        && nodes.some(node => node.closest('.ar-financial-clean'));
      const reportLinkTitle = /^(?:heading|title|page_heading|page_link_label)$/.test(data.slot) && document.querySelector('.cms-section--core-report-page-links');
      const reportOptional = /^(?:subheading|intro)$|^questions__[a-z][a-z0-9]{0,7}__(?:count|open_label)$/.test(data.slot) && nodes.some(node=>node.closest('.national-report-subheading,.national-intro,.core-faq-count,.core-faq-open'));
      const reportImpact = /^(?:impact_heading|impact_before|impact_value|impact_after)$/.test(data.slot) && nodes.some(node => node.closest('.ar-country-section'));
      if (!nodes.length || financialAmount || reportImpact || reportLinkTitle || reportOptional || nodes.some(node => node.getAttribute('data-cms-kind') !== 'text')) {
        post('${PREVIEW_MESSAGE.unpatched}', { section: data.section, slot: data.slot });
        return;
      }
      for (const node of nodes) if (node.textContent !== data.value) node.textContent = data.value;
      frameSelection();
      return;
    }

    if (data.type === '${PREVIEW_MESSAGE.setSelection}') {
      // The parent stores the logical field. Its acknowledgement must not move
      // an occurrence selected on the page back to the first printed copy.
      const same = selected && selected.section === data.section && selected.slot === (data.slot ?? null);
      // Page-selection acknowledgements must not end a site-wide menu edit.
      // Its own mode transition owns the menu's editable state.
      if (!same) for (const node of document.querySelectorAll('[contenteditable="plaintext-only"]')) {
        if (!node.hasAttribute('data-cms-menu-path')) node.removeAttribute('contenteditable');
      }
      const occurrence = Number.isSafeInteger(data.occurrence) && data.occurrence >= 0
        ? data.occurrence : same ? selected.occurrence : 0;
      selected = data.section === null ? null : { section: data.section, slot: data.slot ?? null, occurrence };
      if(selected&&selected.slot){const field=document.querySelector('[data-cms-section="'+selected.section+'"] [data-cms-slot="'+CSS.escape(selected.slot)+'"]'),slide=field&&field.closest('.cms-hero-slide'),track=slide&&slide.closest('[data-cms-hero]');if(track)track.dispatchEvent(new CustomEvent('cms:hero-select',{detail:{key:slide.getAttribute('data-cms-hero-key')}}));}
      paint();
      return;
    }

    if (data.type === '${PREVIEW_MESSAGE.setLabels}' && Array.isArray(data.labels)) {
      data.labels.forEach((label, index) => {
        const node = document.querySelector('[data-cms-section="' + index + '"]');
        if (node && typeof label === 'string') { node.setAttribute('data-cms-label', label); node.setAttribute('title', label); }
      });
      return;
    }

    if (data.type === '${PREVIEW_MESSAGE.setFrameEditing}') {
      frameEditing = data.part === 'header' || data.part === 'footer' ? data.part : null;
      for (const frame of document.querySelectorAll('[data-cms-frame]')) frame.toggleAttribute('data-cms-sitewide',frame.getAttribute('data-cms-frame') === frameEditing);
      for(const node of document.querySelectorAll('[data-cms-menu-path]')) {if(frameEditing)node.setAttribute('draggable','true');else{node.removeAttribute('draggable');node.removeAttribute('contenteditable')}}
      return;
    }
    if (data.type === '${PREVIEW_MESSAGE.setViewport}') {
      document.documentElement.setAttribute('data-cms-viewport', data.viewport);
      // Closed editor palette only. This message is accepted only from our parent.
      for (const key of ['editor-select','status-review','surface','text','status-pending','status-pending-bg','space-1','space-2','space-3','space-4','target-small','text-meta','line-thin','line-focus','radius-control']) {
        const value = data.tokens && data.tokens[key];
        if (typeof value === 'string' && value.length < 80 && !/[;{}<>]/.test(value)) document.documentElement.style.setProperty('--cms-' + key, value);
      }
      for (const node of document.querySelectorAll('[data-cms-hidden-at]')) {
        const hidden = node.getAttribute('data-cms-hidden-at').split(' ').includes(data.viewport === 'mobile' ? 'sm' : data.viewport === 'tablet' ? 'md' : 'lg');
        node.toggleAttribute('data-cms-hidden-device', hidden);
      }

      // When the editor scales this page to fit, draw selection chrome at a
      // readable size: outlines and the section label grow by the inverse scale.
      const scale = Number(data.scale);
      document.documentElement.style.setProperty('--cms-chrome', String(Number.isFinite(scale) && scale > 0 ? 1 / Math.max(scale, 0.25) : 1));
      requestAnimationFrame(paint);
    }
  });

  announceReady();
})();
${HERO_SLIDES_RUNTIME}`

/**
 * Promote the one rendered element of a link, button or image through its editing wrapper with
 * display:contents. That preserves the flex or grid item used on the public page. Rich text can
 * have several blocks; plain text needs a box for the caret. Repeating items use their own wrapper
 * rule.
 */
const CONTENTS_KINDS = ['link', 'button', 'image', 'icon'] as const

/**
 * A wrapper around one of those kinds.
 *
 * `:is()` rather than one rule per kind so each affordance below stays a single
 * rule and the mirroring can be checked by eye. `preview-layout.test.ts` checks
 * it by machine, because by eye is how the mirror came to be missing.
 */
const CONTENTS_SLOT = `cms-slot[data-cms-slot]:is(${CONTENTS_KINDS.map(kind => `[data-cms-kind="${kind}"]`).join(',')})`

/**
 * Outlines and hover affordances. Preview-only, like the script.
 *
 * Every rule that targets `[data-cms-slot]` is written twice: once on the
 * wrapper, and once on the child of a wrapper that generates no box. An element
 * with `display:contents` paints nothing at all — no outline, no background — so
 * without the second copy a link or an image slot would have no resting dashes,
 * no hover feedback and no selection outline, and the author would lose the
 * ability to see what is selected in order to gain the layout fix above. The
 * mirrored declarations are `outline`, `background` and `cursor` only, all of
 * which paint without reserving space, so nothing mirrored here can reintroduce
 * the divergence `display:contents` was added to remove.
 *
 * A wrapper whose field rendered to nothing now paints nothing, where before it
 * was a zero-width span carrying an outline. That is the correct answer rather
 * than a lost affordance: public output has no element there either, and giving
 * preview a box would put an extra flex item on the canvas that the published
 * page does not have.
 *
 * TWO THINGS THAT LOOK LIKE OVERSIGHTS AND ARE NOT
 *
 * The tint is `background-image: linear-gradient(…)` of one flat colour rather
 * than `background`. On a wrapper span the shorthand was harmless because the
 * span had no background of its own; moved onto the child it *replaces* one — a
 * `.button{background:#1f4e79}` anchor lost its colour to a six-percent tint the
 * moment somebody hovered it, which is the canvas misrepresenting the page in
 * order to say something about the canvas. A background image composites over
 * the author's background colour instead of standing in for it, and it is
 * written the same way on both halves so the two cannot drift.
 *
 * The two `[contenteditable]` rules have no mirror, and must not have one. The
 * runtime sets that attribute in exactly one place, guarded on
 * `data-cms-kind === 'text'`, and `text` is not a contents kind — so a mirror
 * of them would be a rule that can never match anything. `preview-layout.test.ts`
 * asserts that guard from the runtime's own source rather than taking this
 * paragraph's word for it.
 */
/**
 * What the canvas draws on top of the page, and how loud each state is.
 *
 * THE AT-REST STATE IS THE ONE THAT WAS WRONG
 *
 * Every editable region carried a dashed outline at a third of full strength,
 * always, so a page of six sections and twenty fields arrived as forty dashed
 * rectangles. That is a wireframe, not a page — an editor could not see what
 * their own page looked like, which is the entire point of editing on the
 * canvas rather than in a form.
 *
 * So the at-rest state is quiet enough to read past and just present enough to
 * find: a hairline on the section, so the bands of the page are legible, and a
 * very faint dashed edge on a field. Hover and selection are where the contrast
 * is spent, because those are momentary and are answering a question somebody
 * has just asked. Nothing here relies on colour alone: the three states differ
 * in line weight and style as well as in hue, and the structure tree names the
 * selected thing in words at the same moment.
 *
 * The two hues are the admin's own: navy for a field, deeper navy for the
 * section that contains it, so a selected field inside a selected section reads
 * as nested rather than as two unrelated boxes. Red is deliberately not used —
 * on a canvas it would read as "this is broken" rather than "this is selected".
 */
export const PREVIEW_STYLES = `
.cms-hidden-notice{display:block;padding:var(--cms-space-2,.5rem) var(--cms-space-3,.75rem);background:var(--cms-status-pending-bg,var(--color-surfaceAlt));color:var(--cms-status-pending,var(--color-ink));border-block:var(--cms-line-thin,.0625rem) solid var(--cms-status-pending,var(--color-ink));font:500 var(--cms-space-3,.75rem)/1.5 system-ui,sans-serif}
[data-cms-section]{position:relative;outline:var(--cms-line-thin,.0625rem) dashed color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 16%,transparent);outline-offset:calc(-1 * var(--cms-line-thin,.0625rem))}
[data-cms-slot]{outline:var(--cms-line-thin,.0625rem) dashed color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 16%,transparent);outline-offset:var(--cms-line-focus,.125rem);cursor:text}
.cms-repeat-preview>*{outline:var(--cms-line-thin,.0625rem) dashed color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 16%,transparent);outline-offset:var(--cms-line-focus,.125rem);cursor:text}
[data-cms-section]:hover{outline-color:color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 34%,transparent)}
[data-cms-frame]{position:relative;outline:var(--cms-line-thin,.0625rem) dashed var(--cms-status-pending,var(--color-ink));outline-offset:calc(-1 * var(--cms-line-thin,.0625rem))}
[data-cms-frame]:not([data-cms-sitewide]):hover::after{content:'Site-wide ' attr(data-cms-frame) ' · click to edit';position:absolute;right:var(--cms-space-2,.5rem);bottom:var(--cms-space-2,.5rem);z-index:60;padding:var(--cms-space-1,.25rem) var(--cms-space-2,.5rem);border-radius:var(--cms-radius-control,.375rem);background:var(--cms-status-pending-bg,var(--color-surfaceAlt));color:var(--cms-status-pending,var(--color-ink));font:600 var(--cms-text-meta,.75rem)/1.4 system-ui,sans-serif;pointer-events:none}
[data-cms-site-controls] [data-cms-frame]:not([data-cms-sitewide]):hover::after{content:'Shared ' attr(data-cms-frame)}
[data-cms-slot]:hover{outline:var(--cms-line-thin,.0625rem) solid color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 55%,transparent);outline-offset:var(--cms-line-focus,.125rem);background-image:linear-gradient(color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 5%,transparent),color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 5%,transparent))}
.cms-repeat-preview:hover>*{outline:var(--cms-line-thin,.0625rem) solid color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 55%,transparent);outline-offset:var(--cms-line-focus,.125rem);background-image:linear-gradient(color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 5%,transparent),color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 5%,transparent))}
[data-cms-section][data-cms-selected],[data-cms-section][data-cms-selected-within]{outline:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1)) solid var(--cms-editor-select,var(--color-primary));outline-offset:calc(-var(--cms-line-focus,.125rem) * var(--cms-chrome,1))}
[data-cms-slot][data-cms-selected]{outline:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1)) solid var(--cms-editor-select,var(--color-primary));outline-offset:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1));background-image:linear-gradient(color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 8%,transparent),color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 8%,transparent))}
.cms-repeat-preview[data-cms-selected]>*{outline:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1)) solid var(--cms-editor-select,var(--color-primary));outline-offset:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1));background-image:linear-gradient(color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 8%,transparent),color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 8%,transparent))}
[data-cms-slot][contenteditable]{outline:var(--cms-line-focus,.125rem) solid var(--cms-editor-select,var(--color-primary))}
[data-cms-slot][contenteditable]:focus{outline-offset:var(--cms-space-1,.25rem)}
[data-cms-inline-editing]{display:block;white-space:pre-wrap;overflow-wrap:break-word;outline-offset:var(--cms-space-1,.25rem)}
[data-cms-inline-editing][data-cms-inline-field]{display:inline}
[data-cms-selected][data-cms-multiline],[data-cms-multiline][contenteditable]{outline:none}
cms-selection-frame{position:absolute;z-index:59;display:block;pointer-events:none;outline:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1)) solid var(--cms-editor-select,var(--color-primary));outline-offset:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1))}
${CONTENTS_SLOT}{display:contents}
.cms-repeat-preview{display:contents}
${CONTENTS_SLOT}>*{outline:var(--cms-line-thin,.0625rem) dashed color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 16%,transparent);outline-offset:var(--cms-line-focus,.125rem);cursor:text}
${CONTENTS_SLOT}:hover>*{outline:var(--cms-line-thin,.0625rem) solid color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 55%,transparent);outline-offset:var(--cms-line-focus,.125rem);background-image:linear-gradient(color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 5%,transparent),color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 5%,transparent))}
${CONTENTS_SLOT}[data-cms-selected]>*{outline:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1)) solid var(--cms-editor-select,var(--color-primary));outline-offset:calc(var(--cms-line-focus,.125rem) * var(--cms-chrome,1));background-image:linear-gradient(color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 8%,transparent),color-mix(in srgb,var(--cms-editor-select,var(--color-primary)) 8%,transparent))}
[data-cms-frame][data-cms-sitewide]{outline:var(--cms-line-focus,.125rem) solid var(--cms-status-review,var(--color-accent));outline-offset:calc(-1 * var(--cms-line-focus,.125rem))}
[data-cms-menu-add] select:focus-visible{outline:calc(var(--cms-line-focus) / var(--cms-editor-scale)) solid var(--cms-editor-select);outline-offset:calc(var(--cms-space-1) / var(--cms-editor-scale))}
[data-cms-menu-path][contenteditable]{outline:var(--cms-line-focus,.125rem) solid var(--cms-status-review,var(--color-accent))}
[data-cms-hidden],[data-cms-hidden-device]{outline-style:dashed!important}
[data-cms-hidden]>*:not(style),[data-cms-hidden-device]>*:not(style){opacity:.5}

`

/**
 * Remove the editor’s instrumentation for the preview and public parity check. Keep this beside the
 * code that adds the instrumentation so new editor markers cannot silently escape the comparison.
 */
export function stripPreviewInstrumentation(html: string): string {
  return (
    html
      // the injected runtime
      .replace(/<script>[\s\S]*?<\/script>/g, '')
      // the injected styles, which are appended inside the page's own <style>
      .replace(PREVIEW_STYLES, '')
      .replace(/ data-cms-(?:entry|reader|list-field|list)="[^"]*"/g, '')
      // slot wrappers, innermost first so nesting unwinds correctly
      .replace(
        /<cms-slot(?: class="cms-repeat-preview")? data-cms-slot="[^"]*" data-cms-kind="[^"]*">([\s\S]*?)<\/cms-slot>/g,
        '$1',
      )
      // section-level attributes
      .replace(/ data-cms-[a-z-]+(="[^"]*")?/g, '')
  )
}

/**
 * The CSP hash for the runtime above.
 *
 * The preview route serves a strict policy, and the canvas needs exactly one
 * inline script. A hash rather than `'unsafe-inline'` means *this* script may
 * run and nothing else can — including anything a hostile stored value might
 * try to smuggle into the same document.
 */
let cachedHash: string | undefined

export function previewScriptHash(): string {
  cachedHash ??= `sha256-${sha256Base64(PREVIEW_RUNTIME)}`
  return cachedHash
}
