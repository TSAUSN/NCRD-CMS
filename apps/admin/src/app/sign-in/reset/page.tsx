import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { EntryPanel } from '../../../components/entry.tsx'
import { authProvider } from '../../../lib/session.ts'
import { RECOVERY_EMAIL_COOKIE, SIGN_IN_METHOD_COOKIE, signInMethod } from '../../../lib/sign-in-flow.ts'
import { completeRecoveryCode, requestPasswordRecovery } from '../../actions/auth.ts'
import { SignInButton } from '../submit-button.tsx'
import styles from '../sign-in.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reset password', robots: { index: false, follow: false }, referrer: 'no-referrer' }

const messages: Record<string, string> = {
  'missing-email': 'Enter the email address you use for this CMS.',
  'invalid-link':
    'That recovery link has expired or was already used. Request a new email below. If this keeps happening, ask your CMS administrator to check email delivery.',
  'invalid-code':
    'That code is incorrect, expired or already used. Try the latest recovery email, or request a new one.',
  'start-again': 'Start by requesting a recovery email in this browser.',
  'rate-limit':
    'Too many requests. Wait a few minutes, then try again. If no email arrives, ask your CMS administrator to check the email sending limit.',
  unavailable: 'Recovery is temporarily unavailable. Try again shortly, or contact your CMS administrator.',
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  if (typeof authProvider().requestPasswordRecovery !== 'function') notFound()
  const { sent, error } = await searchParams
  const jar = await cookies()
  const requested = Boolean(
    jar.get(RECOVERY_EMAIL_COOKIE)?.value && signInMethod(jar.get(SIGN_IN_METHOD_COOKIE)?.value) === 'recovery',
  )
  const codeEnabled = process.env['AUTH_RECOVERY_CODE_ENABLED'] === 'true'
  const checkEmail = sent === '1' && requested
  return (
    <EntryPanel
      heading={checkEmail ? 'Check your recovery email' : 'Reset your password'}
      lede={
        checkEmail
          ? codeEnabled
            ? 'Enter the code from your latest recovery email.'
            : 'Open the latest recovery email in this browser, then choose Continue to reset password.'
          : 'Request a recovery email, verify it, then choose your own password.'
      }
    >
      {error && messages[error] && (
        <p role="alert" className={styles.receipt}>
          {messages[error]}
        </p>
      )}
      {checkEmail && (
        <p role="status" className={styles.receipt}>
          If this address has an account, a recovery email is on its way. Check your inbox and junk folder.
        </p>
      )}
      {checkEmail && codeEnabled && (
        <form action={completeRecoveryCode}>
          <div className="field">
            <label htmlFor="recovery-code">Recovery code</label>
            <input
              id="recovery-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              minLength={6}
              maxLength={10}
              required
              aria-describedby="code-hint"
            />
            <p id="code-hint" className="hint">
              Use the code from the most recent recovery email. It can only be used once.
            </p>
          </div>
          <SignInButton label="Verify recovery code" />
        </form>
      )}
      {(!checkEmail || error === 'invalid-link') && (
        <form action={requestPasswordRecovery}>
          <div className="field">
            <label htmlFor="recovery-email">Email address</label>
            <input
              id="recovery-email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.org"
            />
          </div>
          <SignInButton label="Send recovery email" />
        </form>
      )}
      {checkEmail && (
        <p className={styles.help}>
          No email yet? Wait a few minutes and check junk mail. Repeatedly requesting messages may reach the sender’s
          limit.
        </p>
      )}
      {checkEmail && (
        <p className="entry-note">
          <Link href="/sign-in/reset">Request another recovery email</Link>
        </p>
      )}
      <p className="entry-note">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </EntryPanel>
  )
}
