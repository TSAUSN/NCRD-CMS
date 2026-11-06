import { ButtonAppearance, DEFAULT_THEME_TOKENS } from '@cms/schema'

export function buttonAppearanceClasses(value: unknown): string {
  const parsed = ButtonAppearance.safeParse(value)
  if (!parsed.success) return ''
  const button = parsed.data
  return (
    `cms-button cms-button-instance cms-button-color-${button.color} cms-button-style-${button.style} cms-button-radius-${button.radius} cms-button-hover-${button.hover}` +
    (button.size && button.size !== 'medium' ? ` cms-button-size-${button.size}` : '') +
    (button.weight === 'regular' ? ' cms-button-weight-regular' : '') +
    (button.width === 'full' ? ' cms-button-width-full' : '')
  )
}

/**
 * A solid backing on both treatments keeps the actual text background known,
 * including on photographed/coloured sections. Outline reverses the pair.
 * These are resolved colour literals so definition-local token overrides cannot
 * silently change the contrast pair the inspector and publish command checked.
 */
export function buttonAppearanceCss(colors: Record<string, string> = {}): string {
  const root = '#cms-main a.cms-button-instance'
  let css = `${root}{display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:.62rem 1rem!important;border:2px solid!important;text-decoration:none!important;font-weight:700!important;line-height:1.3!important;transition:transform 180ms,box-shadow 180ms!important}`
  for (const color of ['primary', 'accent'] as const) {
    const contrast = `${color}Contrast` as const
    const background = /^#[0-9a-f]{6}$/i.test(colors[color] ?? '') ? colors[color] : DEFAULT_THEME_TOKENS.colors[color]
    const foreground = /^#[0-9a-f]{6}$/i.test(colors[contrast] ?? '')
      ? colors[contrast]
      : DEFAULT_THEME_TOKENS.colors[contrast]
    const selector = `${root}.cms-button-color-${color}`
    css +=
      `${selector}.cms-button-style-solid{background:${background}!important;color:${foreground}!important;border-color:${background}!important}` +
      `${selector}.cms-button-style-outline{background:${foreground}!important;color:${background}!important;border-color:${background}!important}`
    for (const style of ['solid', 'outline'] as const) {
      const hover = `${selector}.cms-button-style-${style}.cms-button-hover-invert`
      css += `${hover}:hover,${hover}:focus-visible{background:${style === 'solid' ? foreground : background}!important;color:${style === 'solid' ? background : foreground}!important}`
    }
  }
  for (const [radius, value] of Object.entries({ square: '0', soft: '.25rem', rounded: '.65rem', pill: '999px' })) {
    css += `${root}.cms-button-radius-${radius}{border-radius:${value}!important}`
  }
  // Medium, bold and as wide as its words are the defaults above.
  css +=
    `${root}.cms-button-size-small{padding:.42rem .75rem!important;font-size:.875rem!important}` +
    `${root}.cms-button-size-large{padding:.85rem 1.4rem!important;font-size:1.125rem!important}` +
    `${root}.cms-button-weight-regular{font-weight:500!important}` +
    `${root}.cms-button-width-full{display:flex!important;width:100%!important;box-sizing:border-box!important}`
  // Reset the shared theme's hover first; the override is one complete choice.
  css +=
    `${root}:hover,${root}:focus-visible{filter:none!important;transform:none!important;box-shadow:none!important}` +
    `${root}.cms-button-hover-lift:hover,${root}.cms-button-hover-lift:focus-visible{transform:translateY(-2px)!important;box-shadow:0 .45rem 1rem rgba(17,24,39,.18)!important}` +
    `${root}.cms-button-hover-underline:hover,${root}.cms-button-hover-underline:focus-visible{text-decoration:underline!important;text-underline-offset:.2em}` +
    `${root}:focus-visible{outline:3px solid currentColor!important;outline-offset:3px!important}` +
    `@media(prefers-reduced-motion:reduce){${root}{transition:none!important}${root}:hover,${root}:focus-visible{transform:none!important}}`
  return css
}
