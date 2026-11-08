'use server'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../../lib/session.ts'
import { applyImageReplacement, reviewImageReplacement } from '../../../../lib/media-replacement.ts'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function parse(input: unknown, save = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request')
  const value = input as Record<string, unknown>
  const allowed = save ? ['siteId', 'from', 'to', 'fingerprint', 'keys'] : ['siteId', 'from', 'to']
  if (
    Object.keys(value).some(key => !allowed.includes(key)) ||
    ['siteId', 'from', 'to'].some(key => typeof value[key] !== 'string' || !UUID.test(value[key]))
  )
    throw new Error('Invalid request')
  if (
    save &&
    (typeof value.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
      !Array.isArray(value.keys) ||
      !value.keys.length ||
      value.keys.length > 2000 ||
      value.keys.some(key => typeof key !== 'string' || key.length > 80))
  )
    throw new Error('Invalid review')
  return value as { siteId: string; from: string; to: string; fingerprint: string; keys: string[] }
}
function message(error: unknown, fallback: string) {
  if (!(error instanceof DomainError)) return fallback
  if (error.kind === 'stale_revision')
    return 'An image or saved item changed. Review the replacement again before saving.'
  if (error.kind === 'not_authorized')
    return 'You no longer have permission to change one of these destinations. Review again with your current access.'
  if (error.kind === 'not_found')
    return 'An image or destination is no longer available. Choose another image and review again.'
  return 'A saved destination cannot use this replacement. Open it to check its fields, then review again.'
}
export async function prepareImageReplacement(input: unknown) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before replacing an image.' }
  try {
    const value = parse(input)
    return {
      ok: true as const,
      review: await reviewImageReplacement(session.principal.userId, value.siteId, value.from, value.to),
    }
  } catch (error) {
    return { ok: false as const, message: message(error, 'The replacement could not be reviewed. Try again.') }
  }
}
export async function saveImageReplacement(input: unknown) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving.' }
  try {
    const value = parse(input, true)
    return {
      ok: true as const,
      ...(await applyImageReplacement(
        session.principal.userId,
        value.siteId,
        value.from,
        value.to,
        value.fingerprint,
        value.keys,
      )),
    }
  } catch (error) {
    return {
      ok: false as const,
      message: message(error, 'The save could not be confirmed. Review again before retrying.'),
    }
  }
}
