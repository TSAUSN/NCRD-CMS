import { isCmsIcon, type CmsIconName } from '@cms/schema'

// Fixed paths in a 24-unit grid; no stored value becomes markup or an attribute.
const PATHS: Record<CmsIconName, string> = {
  target:
    'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2M12 6A6 6 0 1 0 12 18A6 6 0 1 0 12 6M12 10A2 2 0 1 0 12 14A2 2 0 1 0 12 10',
  gift: 'M3 8H21V12H3ZM5 12V22H19V12M12 8V22M12 8C3 9 4 0 8 3L12 8L16 3C20 0 21 9 12 8',
  handshake: 'M3 8 7 4 12 6 17 4 22 9 18 15 13 20 4 12ZM7 4 10 9 14 10 17 7M7 15 11 18M10 12 15 17',
  lightbulb: 'M9 19H15M10 22H14M8 14A7 7 0 1 1 16 14L15 17H9Z',
  network: 'M12 8V3M9 10 4 7M9 14 4 17M15 10 20 7M15 14 20 17M8 12A4 4 0 1 0 16 12A4 4 0 1 0 8 12',
  'globe-outline': 'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2M2 12H22M12 2C6 7 6 17 12 22C18 17 18 7 12 2',
  globe: 'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2M2 12H22M12 2C6 7 6 17 12 22C18 17 18 7 12 2',
  flag: 'M5 22V2L20 5V15L5 12',
  shield: 'M12 3 20 6V11C20 16 16 20 12 22C8 20 4 16 4 11V6ZM8 12 11 15 16 9',
  bolt: 'M13 2 4 14H11L10 22 20 10H13Z',
  heart: 'M12 21 3 12C-3 5 6-1 12 6 18-1 27 5 21 12Z',
  home: 'M3 11 12 3 21 11M5 10V21H10V15H14V21H19V10',
  users: 'M3 21V18Q3 14 8 14Q13 14 13 18V21M16 14Q21 14 21 18V21M8 3A4 4 0 1 0 8 11A4 4 0 1 0 8 3M16 3A4 4 0 0 1 16 11',
  star: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
  check: 'm4 12 5 5L20 5',
  info: 'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2M12 11V17M12 7V7.1',
  'dollar-sign': 'M12 2V22M18 6H9A4 4 0 0 0 9 14H15A4 4 0 0 1 15 22H6',
  'bar-chart-2': 'M4 20V12M12 20V4M20 20V8',
  'bar-chart-3': 'M3 3V21H21M7 17V12M12 17V7M17 17V10',
  'flask-conical': 'M9 3H15M10 3V10L4 20Q3 22 6 22H18Q21 22 20 20L14 10V3M7 16H17',
  'file-text': 'M14 2H5V22H19V7ZM14 2V7H19M8 12H16M8 16H16',
  calendar: 'M3 5H21V22H3ZM7 2V8M17 2V8M3 11H21M7 15H9M13 15H15M7 18H9',
  mail: 'M2 4H22V20H2ZM2 5 12 13 22 5',
  phone: 'M5 2 2 5Q2 20 19 22L22 19 16 14 13 17Q7 14 7 10L10 7Z',
  'map-pin': 'M12 22Q3 13 3 10A9 9 0 0 1 21 10Q21 13 12 22ZM12 6A3 3 0 1 0 12 12A3 3 0 1 0 12 6',
  'arrow-right': 'M3 12H21M14 5 21 12 14 19',
  'chevron-right': 'm9 6 6 6-6 6',
}
export function renderCmsIcon(value: unknown): string {
  if (!isCmsIcon(value)) return ''
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${PATHS[value]}"/></svg>`
}

const MATERIAL_NAMES: Record<CmsIconName, string> = {
  target: 'adjust',
  gift: 'redeem',
  handshake: 'handshake',
  lightbulb: 'lightbulb',
  network: 'hub',
  'globe-outline': 'language',
  globe: 'public',
  flag: 'flag',
  shield: 'verified_user',
  bolt: 'bolt',
  heart: 'favorite',
  home: 'home',
  users: 'groups',
  star: 'star',
  check: 'check',
  info: 'info',
  'dollar-sign': 'volunteer_activism',
  'bar-chart-2': 'bar_chart',
  'bar-chart-3': 'monitoring',
  'flask-conical': 'science',
  'file-text': 'description',
  calendar: 'calendar_month',
  mail: 'mail',
  phone: 'call',
  'map-pin': 'location_on',
  'arrow-right': 'arrow_forward',
  'chevron-right': 'chevron_right',
}
/** An allowlisted ligature from the shipped, self-hosted symbol font. */
export function renderMaterialIcon(value: unknown): string {
  return isCmsIcon(value) ? `<span class="cms-material-symbols" aria-hidden="true">${MATERIAL_NAMES[value]}</span>` : ''
}
