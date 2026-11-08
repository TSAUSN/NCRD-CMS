import { ThemeTokens, type ThemeTokens as Tokens } from '@cms/schema'
import { checkContrast } from '@cms/domain'

/** Match the existing database exception; every other colour pair still needs AA. */
export function themePublishReadiness(tokens: Tokens) {
  const parsed = ThemeTokens.safeParse(tokens)
  const approvedPrimary = parsed.success && parsed.data.presentation?.referenceContrast !== undefined
  const passes = (ink: string, surface: string) => checkContrast(ink, surface)?.passesAA === true
  return {
    approvedPrimary,
    ready:
      parsed.success &&
      passes(tokens.colors.ink, tokens.colors.surface) &&
      (approvedPrimary || passes(tokens.colors.primaryContrast, tokens.colors.primary)) &&
      passes(tokens.colors.accentContrast, tokens.colors.accent),
  }
}
