/** Presentation context only. Identity still comes from the provider and CMS membership. */
export const SIGN_IN_METHOD_COOKIE = '__Host-cms-sign-in-method'
export type SignInMethod = 'email' | 'microsoft'

export function signInMethod(value: string | undefined): SignInMethod {
  return value === 'microsoft' ? 'microsoft' : 'email'
}

export function confirmationState({
  code,
  tokenHash,
  type,
  providerError,
  browserProof,
  method,
}: {
  code?: string
  tokenHash?: string
  type?: string
  providerError: boolean
  browserProof: boolean
  method: SignInMethod
}) {
  const codeValid = Boolean(code && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code))
  const emailTokenValid = Boolean(!code && tokenHash && /^[a-zA-Z0-9_-]{20,512}$/.test(tokenHash) && type === 'email')
  // Errors win over credential-shaped parameters. Never echo provider text or tokens.
  const valid = !providerError && (codeValid ? browserProof : emailTokenValid)
  const message =
    codeValid && !browserProof
      ? 'Finish signing in in the browser where you started, or start again here.'
      : method === 'microsoft'
        ? 'Microsoft sign-in did not finish. Start again, or use your email and password. If your organization blocks sign-in, ask your CMS administrator to check the Microsoft setup with IT.'
        : providerError
          ? 'This sign-in link was already used or has expired. Some email systems open links to check them before you do, which uses the link up. Sign in with your password, or request another link.'
          : 'This sign-in link is incomplete, expired or already used. Sign in with your password, or request a new link.'
  return { valid, codeValid, message }
}
