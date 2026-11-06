import postcss from 'postcss'
import { SectionAppearance, type SectionAppearance as Appearance } from '@cms/schema'

type Definition = {
  slug?: string
  definition_kind?: string | null
  structured_doc?: unknown
  css?: string
  slots?: readonly { kind: string; constraints?: Record<string, unknown> }[]
}
export type AppearanceSupport = {
  layout: boolean
  surface: boolean
  mobileOrder?: boolean
  imagePosition?: boolean
  imageFirst?: boolean
  width?: boolean
  spacing?: boolean
  alignment?: boolean
  reason?: string
  surfaceReason?: string
}

export function supportsMobileStackOrder(document: unknown): boolean {
  const nodes = (document as { nodes?: unknown[] } | null)?.nodes
  if (!Array.isArray(nodes)) return false
  const stack = [...nodes]
  let containers = 0,
    visited = 0
  while (stack.length) {
    if (++visited > 2000) return false
    const node = stack.pop() as { type?: string; attributes?: { class?: unknown }; children?: unknown[] }
    if (!node || node.type !== 'element') continue
    if (typeof node.attributes?.class === 'string' && node.attributes.class.split(/\s+/).includes('builder-columns')) {
      if (
        !Array.isArray(node.children) ||
        node.children.length !== 2 ||
        node.children.some(child => (child as { type?: string })?.type !== 'element')
      )
        return false
      containers += 1
    }
    if (Array.isArray(node.children)) stack.push(...node.children)
  }
  return containers === 1
}

/** Be conservative about templates whose own colours could conceal an author's choice. */
export function sectionAppearanceSupport(def: Definition): AppearanceSupport {
  const metadata = def.slots?.[0]?.constraints
  if (metadata?.coreLibrary === 'r8' && metadata.coreCapabilities && typeof metadata.coreCapabilities === 'object') {
    const flags = metadata.coreCapabilities as Record<string, unknown>
    return {
      layout: flags.width === true || flags.spacing === true || flags.alignment === true,
      surface: flags.background === true,
      mobileOrder: flags.phoneOrder === true,
      imagePosition: flags.imagePosition === true,
      imageFirst: def.slug === 'core-text-image',
      width: flags.width === true,
      spacing: flags.spacing === true,
      alignment: flags.alignment === true,
    }
  }
  const doc = def.structured_doc as { nodes?: { type?: string; tag?: string }[] } | null | undefined
  if (
    def.definition_kind !== 'structured' ||
    !Array.isArray(doc?.nodes) ||
    doc.nodes.length !== 1 ||
    doc.nodes[0]?.type !== 'element' ||
    !['section', 'div', 'article'].includes(doc.nodes[0]?.tag ?? '')
  ) {
    return {
      layout: false,
      surface: false,
      reason:
        'This definition controls its own layout. Appearance controls are available for structured sections with one content container.',
    }
  }
  let surface = !def.slots?.some(slot => slot.kind === 'button')
  try {
    postcss.parse(def.css ?? '').walkDecls(decl => {
      const property = decl.prop.toLowerCase()
      const value = decl.value.toLowerCase().replace(/\s+/g, '')
      if (
        decl.prop.includes('\\') ||
        decl.value.includes('\\') ||
        (property === 'position' && ['absolute', 'fixed'].includes(value))
      )
        surface = false
      if (property === 'color' && !/^(inherit|currentcolor|var\(--color-ink(?:,[^)]*)?\))$/.test(value)) surface = false
      if (property === 'background' || property === 'background-color') {
        if (!/^(transparent|none|var\(--color-surface(?:alt)?(?:,[^)]*)?\))$/.test(value)) surface = false
      }
      if (
        ['background-image', 'opacity', 'filter', 'mix-blend-mode', '-webkit-text-fill-color'].includes(property) ||
        property.startsWith('--color-') ||
        property.startsWith('--button-')
      )
        surface = false
    })
  } catch {
    return {
      layout: false,
      surface: false,
      reason: 'This definition’s stylesheet must be repaired before appearance can change.',
    }
  }
  return {
    layout: true,
    surface,
    mobileOrder: supportsMobileStackOrder(def.structured_doc),
    ...(!surface
      ? {
          surfaceReason:
            'This section paints its own colours or layered backgrounds. Keep its original surface; its definition controls those colours.',
        }
      : {}),
  }
}

const SPACING = {
  compact: 'clamp(1rem,2vw,1.5rem)',
  comfortable: 'clamp(2rem,4vw,3rem)',
  spacious: 'clamp(3rem,6vw,5rem)',
}
const WIDTH = { reading: '42rem', standard: '60rem', wide: '72rem', full: '100%' }
const SURFACES = {
  dark: ['var(--color-ink)', 'var(--color-surface)'],
  page: ['var(--color-surface,#ffffff)', 'var(--color-ink,#172033)'],
  soft: ['var(--color-surfaceAlt,#f4f6f8)', 'var(--color-ink,#172033)'],
  primary: ['var(--color-primary,#003087)', 'var(--color-primaryContrast,#ffffff)'],
  accent: ['var(--color-accent,#d22630)', 'var(--color-accentContrast,#ffffff)'],
} as const

export function sectionAppearanceCss(def: Definition, value: unknown, index: number): string {
  if (value === undefined) return ''
  const parsed = SectionAppearance.safeParse(value)
  if (!parsed.success || !sectionAppearanceSupport(def).layout) return ''
  const appearance: Appearance = parsed.data
  const core = def.slots?.[0]?.constraints?.coreLibrary === 'r8'
  const root = `#s${index}>:only-child`
  const content = core ? `${root}>.container` : root
  const declarations: string[] = []
  if (appearance.spacing) declarations.push(`padding-block:${SPACING[appearance.spacing]}!important`)
  if (appearance.width && !core)
    declarations.push(
      `box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:${WIDTH[appearance.width]}!important;margin-inline:auto!important`,
    )
  if (appearance.align) declarations.push(`text-align:${appearance.align}!important`)
  let css = declarations.length ? `${root}{${declarations.join(';')}}` : ''
  if (appearance.width && core) css += `${content}{max-width:${WIDTH[appearance.width]}!important}`
  if (appearance.imagePosition && core && sectionAppearanceSupport(def).imagePosition) {
    const reverse = (appearance.imagePosition === 'left') !== sectionAppearanceSupport(def).imageFirst
    css += `@media(min-width:48em){#s${index} .row{flex-direction:${reverse ? 'row-reverse' : 'row'}!important}}`
  }
  if (appearance.mobileOrder === 'reverse' && sectionAppearanceSupport(def).mobileOrder) {
    css += `@media(max-width:767px){#s${index} ${core ? '.row' : '.builder-columns'}{display:flex!important;flex-direction:column-reverse!important}#s${index} ${core ? '.row' : '.builder-columns'}>*{width:100%!important;min-width:0!important;order:0!important}}`
  }
  if (appearance.surface && sectionAppearanceSupport(def).surface) {
    const [background, foreground] = SURFACES[appearance.surface]
    // Resolve theme values on the outer wrapper; override the inner container's
    // inherited text token without creating a self-referential custom property.
    css +=
      `#s${index}{--cms-appearance-bg:${background};--cms-appearance-ink:${foreground};background:var(--cms-appearance-bg);color:var(--cms-appearance-ink)}` +
      `${root}{--color-ink:var(--cms-appearance-ink);--color-surface:var(--cms-appearance-bg);--color-surfaceAlt:var(--cms-appearance-bg);background:var(--cms-appearance-bg)!important;color:var(--cms-appearance-ink)!important}` +
      `${root} a:not(.cms-button){color:inherit;text-decoration:underline}`
  }
  return css
}
