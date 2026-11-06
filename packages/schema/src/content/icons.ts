/** Code-owned decorative symbols. Content stores a name, never SVG or a URL. */
export const CMS_ICONS = {
  target: 'Purpose',
  gift: 'Gift',
  handshake: 'Partnership',
  lightbulb: 'Ideas',
  network: 'Connections',
  'globe-outline': 'Worldwide',
  globe: 'Globe',
  flag: 'Flag',
  shield: 'Protection',
  bolt: 'Power',
  heart: 'Heart',
  home: 'Home',
  users: 'People',
  star: 'Star',
  check: 'Check',
  info: 'Information',
  'dollar-sign': 'Giving',
  'bar-chart-2': 'Bar chart',
  'bar-chart-3': 'Statistics',
  'flask-conical': 'Research',
  'file-text': 'Document',
  calendar: 'Calendar',
  mail: 'Email',
  phone: 'Phone',
  'map-pin': 'Location',
  'arrow-right': 'Arrow right',
  'chevron-right': 'Next',
} as const
export type CmsIconName = keyof typeof CMS_ICONS
export const MATERIAL_ICON_PRESENTATION = 'cms-material-symbols-v1'
export const ICON_PRESENTATION = 'cms-line-icons-v1'
export function isCmsIcon(value: unknown): value is CmsIconName {
  return typeof value === 'string' && Object.hasOwn(CMS_ICONS, value)
}
export function isIconSlot(slot: { kind?: string; constraints?: Record<string, unknown> }): boolean {
  return (
    slot.kind === 'text' &&
    (slot.constraints?.presentation === ICON_PRESENTATION ||
      slot.constraints?.presentation === MATERIAL_ICON_PRESENTATION)
  )
}
