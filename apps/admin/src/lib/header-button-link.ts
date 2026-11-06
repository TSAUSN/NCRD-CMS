import { NavUrl } from '@cms/schema'
import { safeUrl } from '@cms/renderer'
/** Preserve frame website policy and add only the two non-executing contact schemes. */
export function validHeaderButtonUrl(value: unknown): value is string {
  if (NavUrl.safeParse(value).success) return true
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    !/[\s\\]/.test(value) &&
    /^(?:mailto|tel):.+$/i.test(value) &&
    safeUrl(value) === value
  )
}
