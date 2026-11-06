import { ThemeTokens, type ThemeTokens as Tokens } from '@cms/schema'
import { checkContrast } from '@cms/domain'

/** Match the existing database exception; every other colour pair still needs AA. */
export function themePublishReadiness(tokens: Tokens) {
  const valid = ThemeTokens.safeParse(tokens).success
  const approvedPrimary =
    valid &&
    tokens.presentation?.referenceContrast === 'sawso-2026-10-29' &&
    tokens.presentation.layout === 'national' &&
    tokens.colors.primary.toLowerCase() === '#ef3e42' &&
    tokens.colors.primaryContrast.toLowerCase() === '#ffffff'
  const passes = (ink: string, surface: string) => checkContrast(ink, surface)?.passesAA === true
  return {
    approvedPrimary,
    ready:
      valid &&
      passes(tokens.colors.ink, tokens.colors.surface) &&
      (approvedPrimary || passes(tokens.colors.primaryContrast, tokens.colors.primary)) &&
      passes(tokens.colors.accentContrast, tokens.colors.accent),
  }
}
