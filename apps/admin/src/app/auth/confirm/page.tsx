import Link from 'next/link'
import { EntryPanel } from '../../../components/entry.tsx'
import { completeSignIn } from '../../actions/auth.ts'
import { SignInButton } from '../../sign-in/submit-button.tsx'
import { cookies } from 'next/headers'
import { SIGN_IN_PROOF_COOKIE } from '@cms/platform'
import { confirmationState, SIGN_IN_METHOD_COOKIE, signInMethod } from '../../../lib/sign-in-flow.ts'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Confirm sign-in', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/** GET does not consume the one-time credential: email security scanners may
 * open links before the person does. Only an explicit form submission signs in
 * to the CMS. PKCE additionally requires the initiating browser's proof. */
export default async function ConfirmSignIn({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; code?: string; error?: string; error_code?: string }>
}) {
  const { token_hash: tokenHash, type, code, error, error_code: errorCode } = await searchParams
  // The provider sends people back with an error instead of a code when the
  // emailed link was already opened once, for example by a mail security scan.
  // Supabase can also put errors in a URL fragment, which the server cannot
  // read. The incomplete-link fallback must offer the same safe recovery.
  const jar = await cookies()
  const method = signInMethod(jar.get(SIGN_IN_METHOD_COOKIE)?.value)
  const { valid, codeValid, message } = confirmationState({
    code,
    tokenHash,
    type,
    providerError: Boolean(error || errorCode),
    browserProof: jar.has(SIGN_IN_PROOF_COOKIE),
    method,
  })
  const recovery = method === 'recovery' || type === 'recovery'
  return (
    <EntryPanel
      heading={recovery ? 'Confirm password recovery' : 'Confirm sign-in'}
      lede={
        valid
          ? recovery
            ? 'Continue to choose your new password.'
            : code
              ? 'Continue to finish signing in.'
              : 'Continue to sign in using the link from your email.'
          : recovery
            ? 'Request a new recovery email to continue.'
            : method === 'microsoft'
              ? 'Try Microsoft again, or use your password.'
              : 'Use your password or request a new sign-in link.'
      }
    >
      {valid ? (
        <form action={completeSignIn}>
          <input type="hidden" name="type" value={type === 'recovery' ? 'recovery' : 'email'} />
          {codeValid ? (
            <input type="hidden" name="authCode" value={code} />
          ) : (
            <input type="hidden" name="tokenHash" value={tokenHash} />
          )}
          <SignInButton label={recovery ? 'Continue to reset password' : 'Continue to CMS'} />
        </form>
      ) : (
        <p role="alert">{message}</p>
      )}
      <p className="entry-note">
        {recovery ? (
          <Link href="/sign-in/reset">Request a new recovery email</Link>
        ) : (
          <Link href="/sign-in">Go to sign in</Link>
        )}
      </p>
    </EntryPanel>
  )
}
