import { z } from 'zod'

/**
 * Named local stacks plus the fixed approved Adobe kit families.
 * The value is stored rather than the label so published output stays portable.
 */
export const THEME_FONT_OPTIONS = [
  { label: 'Open Sans', value: "'Open Sans', Arial, sans-serif" },
  { label: 'Source Serif 4', value: "'Source Serif 4', Georgia, serif" },
  { label: 'System sans', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { label: 'Humanist sans', value: "Optima, Candara, 'Noto Sans', sans-serif" },
  { label: 'Classic serif', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Book serif', value: "Iowan Old Style, Baskerville, 'Times New Roman', serif" },
  { label: 'Technical mono', value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  // Existing v2 fixtures and stored themes used this before named choices were
  // introduced. It stays selectable so normalising an old draft is lossless.
  { label: 'Generic system sans', value: 'system-ui, sans-serif' },
  { label: 'Creato Display (local)', value: "'Creato Display', 'Open Sans', Arial, sans-serif" },
  { label: 'Trajan Pro 3 (Adobe)', value: "'trajan-pro-3', 'Source Serif 4', Georgia, serif" },
  { label: 'Proxima Nova (Adobe)', value: "'proxima-nova', 'Open Sans', Arial, sans-serif" },
  { label: 'Proxima Nova Condensed (Adobe)', value: "'proxima-nova-condensed', 'Open Sans', Arial, sans-serif" },
  {
    label: 'Proxima Nova Extra Condensed (Adobe)',
    value: "'proxima-nova-extra-condensed', 'Open Sans', Arial, sans-serif",
  },
] as const

const fontStacks = THEME_FONT_OPTIONS.map(font => font.value) as [string, ...string[]]
export const ThemeFontStack = z.enum(fontStacks)
export const ThemeRadius = z.enum(['0rem', '0.25rem', '0.5rem', '0.75rem', '1rem', '1.25rem'])
export const ThemeColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a six-digit hex colour such as #003087.')

const ThemeButtons = z
  .object({
    style: z.enum(['solid', 'outline', 'text']),
    color: z.enum(['primary', 'accent']),
    radius: ThemeRadius,
    weight: z.enum(['regular', 'bold']),
    hover: z.enum(['none', 'darken', 'lift', 'invert', 'underline']),
    speed: z.enum(['fast', 'normal', 'slow']),
  })
  .strict()

export const DEFAULT_THEME_TOKENS = {
  colors: {
    primary: '#003087',
    accent: '#d22630',
    surface: '#ffffff',
    surfaceAlt: '#f4f6f8',
    ink: '#172033',
    muted: '#5f6b7a',
    primaryContrast: '#ffffff',
    accentContrast: '#ffffff',
  },
  fonts: {
    heading: "Georgia, 'Times New Roman', serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  radius: '0.5rem',
  spacing: 'comfortable',
  buttons: {
    style: 'solid',
    color: 'primary',
    radius: '0.25rem',
    weight: 'bold',
    hover: 'darken',
    speed: 'normal',
  },
} as const

// A theme is a design system, not an arbitrary bag of CSS values; free CSS
// remains the separately governed code path. Defaults let old themes be
// normalised in memory and saved as a new version without rewriting history.
export const ThemeTokens = z
  .object({
    colors: z
      .object({
        primary: ThemeColor,
        accent: ThemeColor.default(DEFAULT_THEME_TOKENS.colors.accent),
        surface: ThemeColor,
        surfaceAlt: ThemeColor.default(DEFAULT_THEME_TOKENS.colors.surfaceAlt),
        ink: ThemeColor,
        muted: ThemeColor.default(DEFAULT_THEME_TOKENS.colors.muted),
        primaryContrast: ThemeColor.default(DEFAULT_THEME_TOKENS.colors.primaryContrast),
        accentContrast: ThemeColor.default(DEFAULT_THEME_TOKENS.colors.accentContrast),
      })
      .strict(),
    fonts: z
      .object({
        heading: ThemeFontStack,
        body: ThemeFontStack,
        adobeKit: z
          .object({
            id: z.literal('euh2hvn'),
            enabled: z.boolean(),
            domains: z
              .array(
                z
                  .string()
                  .min(1)
                  .max(253)
                  .refine(
                    host =>
                      host === host.toLowerCase() &&
                      host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
                    'Use a hostname without a protocol, port or path.',
                  ),
              )
              .max(10),
          })
          .strict()
          .optional(),
      })
      .strict(),
    radius: ThemeRadius.default(DEFAULT_THEME_TOKENS.radius),
    spacing: z.enum(['compact', 'comfortable', 'spacious']).default(DEFAULT_THEME_TOKENS.spacing),
    presentation: z
      .object({
        kind: z.literal('panels'),
        canvas: ThemeColor,
        headings: z.literal('small-caps').optional(),
        layout: z.literal('national').optional(),
        referenceContrast: z.literal('sawso-2026-10-29').optional(),
        template: z
          .object({
            id: z.literal('national'),
            version: z.number().int().min(1).max(1000000),
            mayChangeColours: z.boolean(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    buttons: ThemeButtons.default(DEFAULT_THEME_TOKENS.buttons),
  })
  .strict()
  .superRefine((theme, context) => {
    if (theme.presentation?.template && theme.presentation.layout !== 'national')
      context.addIssue({
        code: 'custom',
        path: ['presentation', 'template'],
        message: 'The national template requires the national layout.',
      })
    if (
      theme.presentation?.referenceContrast &&
      (theme.presentation.layout !== 'national' ||
        theme.colors.primary.toLowerCase() !== '#ef3e42' ||
        theme.colors.primaryContrast.toLowerCase() !== '#ffffff')
    )
      context.addIssue({
        code: 'custom',
        path: ['presentation', 'referenceContrast'],
        message: 'The approved SAWSO reference exception requires the national layout and exact red/white pair.',
      })
  })

export type ThemeTokens = z.infer<typeof ThemeTokens>
