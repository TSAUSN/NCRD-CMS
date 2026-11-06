// Shared browser-safe names for the checked preview bridge.
export const PREVIEW_MESSAGE = {
  /** canvas → editor: use the page's history, including inspector/structure edits */
  undo: 'cms:undo',
  redo: 'cms:redo',
  /** canvas → editor: the reader clicked something selectable */
  select: 'cms:select',
  selectListItem: 'cms:select-list-item',
  selectFrame: 'cms:select-frame',
  editFrameMenu: 'cms:edit-frame-menu',
  moveFrameMenu: 'cms:move-frame-menu',
  setFrameEditing: 'cms:set-frame-editing',
  /** canvas → editor: inline text editing produced a new value */
  edit: 'cms:edit',
  /** canvas → editor: mount the shared structured editor at this rich-text slot */
  editRichText: 'cms:edit-richtext',
  /** editor → canvas: set a slot's value (typing in the inspector) */
  setValue: 'cms:set-value',
  /**
   * canvas → editor: that value could not be written into this page.
   *
   * The editor patches what it believes it can and renders the rest, but what
   * it believes is read from the definition, and what is actually on the page
   * is read from the page. Where the two disagree — a slot the template uses
   * inside an attribute, so it has no node of its own; a section that is hidden,
   * so it has no nodes at all — the patch has nowhere to land. Saying so is
   * what turns that into a render instead of into a canvas that quietly stopped
   * agreeing with the document.
   */
  unpatched: 'cms:unpatched',
  /** editor → canvas: move the selection outline */
  setSelection: 'cms:set-selection',
  /** editor → canvas: switch which breakpoint the canvas is emulating */
  setViewport: 'cms:set-viewport',
  /**
   * editor → canvas: the name each section shows on the canvas, by position.
   * A private label is an editor edit, not a field value, so it never reaches
   * the page through a render; and an unlabelled section is named after its
   * layout, which the editor knows and the rendered page does not.
   */
  setLabels: 'cms:set-labels',
  /** canvas → editor: the document is ready to receive messages */
  ready: 'cms:ready',
  /** canvas → editor: read-only availability from this preview address */
  fontStatus: 'cms:font-status',
  /** canvas → editor: bounded read-only frame size, with the same ticket channel */
  frameSize: 'cms:frame-size',
  /** editor → canvas: repeat readiness after hydration or a frame load */
  requestReady: 'cms:request-ready',
  /**
   * canvas → editor: a section from the docked library was dropped on the
   * page, in the gap before section `at` (V1 reference 10). The canvas only
   * names the gap it can see; the editor decides whether the section exists
   * and whether the page may take it.
   */
  dropSection: 'cms:drop-section',
  /** editor → canvas: a library drag ended, including an Escape cancellation */
  cancelDrop: 'cms:cancel-drop',
} as const
