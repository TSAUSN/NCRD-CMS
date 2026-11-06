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
  searchParams: Promise<{ token_hash?: string; type?: string; code?: string }>
}) {
  const { token_hash: tokenHash, type, code } = await searchParams
  const codeValid = code && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)
  const browserProof = (await cookies()).has(SIGN_IN_PROOF_COOKIE)
  const valid = codeValid
    ? browserProof
    : !code && tokenHash && /^[a-zA-Z0-9_-]{20,512}$/.test(tokenHash) && type === 'email'
  return (
    <EntryPanel heading="Confirm sign-in" lede="Continue to sign in using the link from your email.">
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
            : 'This link is incomplete. Request another sign-in link.'}
        </p>
      )}
      <p className="entry-note">
        <Link href="/sign-in">Use a different email or request a new link</Link>
      </p>
    </EntryPanel>
  )
}
