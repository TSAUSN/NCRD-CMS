import Link from 'next/link'
import { EntryPanel } from '../../../components/entry.tsx'
import { completeSignIn } from '../../actions/auth.ts'
import { SignInButton } from '../../sign-in/submit-button.tsx'
import { cookies } from 'next/headers'
import { SIGN_IN_PROOF_COOKIE } from '@cms/platform'

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
  const spent = !code && !tokenHash && Boolean(error || errorCode)
  const codeValid = code && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)
  const browserProof = (await cookies()).has(SIGN_IN_PROOF_COOKIE)
  const valid = codeValid
    ? browserProof
    : !code && tokenHash && /^[a-zA-Z0-9_-]{20,512}$/.test(tokenHash) && type === 'email'
  return (
    <EntryPanel
      heading="Confirm sign-in"
      lede={
        valid
          ? code
            ? 'Continue to finish signing in.'
            : 'Continue to sign in using the link from your email.'
          : 'Use your password or request a new sign-in link.'
      }
    >
      {valid ? (
        <form action={completeSignIn}>
          {codeValid ? (
            <input type="hidden" name="authCode" value={code} />
          ) : (
            <input type="hidden" name="tokenHash" value={tokenHash} />
          )}
          <SignInButton label="Continue to CMS" />
        </form>
      ) : (
        <p role="alert">
          {codeValid && !browserProof
            ? 'Open this link in the browser where you requested it, or start sign-in again here.'
            : spent
              ? 'This sign-in link was already used or has expired. Some email systems open links to check them before you do, which uses the link up. Sign in with your password, or request another link.'
              : 'This sign-in link is incomplete, expired or already used. Sign in with your password, or request a new link.'}
        </p>
      )}
      <p className="entry-note">
        <Link href="/sign-in">Go to sign in</Link>
      </p>
    </EntryPanel>
  )
}
