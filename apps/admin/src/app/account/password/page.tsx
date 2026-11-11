import { notFound } from 'next/navigation'
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from '@cms/platform'
import { AppShell } from '../../../components/app-shell.tsx'
import { IconAlert, IconCheck } from '../../../components/icons.tsx'
import { navigationFor } from '../../../components/nav.ts'
import { PageHeader } from '../../../components/shell.tsx'
import { roleLabel } from '../../../lib/queries.ts'
import { authProvider, currentSession } from '../../../lib/session.ts'
import { setPassword } from '../../actions/auth.ts'
import { SignInButton } from '../../sign-in/submit-button.tsx'
import styles from './password.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Password' }

const messages: Record<string, string> = {
  'too-short': `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  'too-long': 'That password is too long. Use a shorter one.',
  mismatch: 'The two passwords do not match. Type the same password in both boxes.',
  weak: 'That password is too easy to guess. Choose a longer or less common one.',
  unchanged: 'That is already your password. Choose a different one, or leave this page.',
  'too-many-tries': 'Too many attempts. Wait a few minutes, then try again.',
  unavailable: 'The password could not be saved. Nothing changed. Try again shortly.',
}

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>
}) {
  const session = await currentSession()
  if (!session || typeof authProvider().setPassword !== 'function') notFound()
  const { error, saved } = await searchParams
  const role = await roleLabel(session.principal.userId)
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(undefined, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          crumbs={[{ label: 'Home', href: '/' }, { label: 'Password' }]}
          title="Password"
          lede="Set a password so you can sign in without waiting for an email. Only you can set it, and it replaces any password you set before."
        />
        <form action={setPassword} className={`card ${styles.form}`}>
          {saved === '1' && !error && (
            <p className="notice notice-ok" role="status">
              <IconCheck size={16} />
              <span className="notice-body">
                Your password is saved. Next time, sign in with {session.email} and this password.
              </span>
            </p>
          )}
          {error && messages[error] && (
            <p className="notice notice-error" role="alert">
              <IconAlert size={16} />
              <span className="notice-body">{messages[error]}</span>
            </p>
          )}
          {/* Lets a password manager file the new password under the right account. */}
          <input type="email" name="email" value={session.email} autoComplete="username" readOnly hidden />
          <div className="field">
            <label htmlFor="password">New password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_BYTES}
              autoComplete="new-password"
              aria-describedby="password-hint"
            />
            <p className="hint" id="password-hint">
              At least {PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.
            </p>
          </div>
          <div className="field">
            <label htmlFor="password-again">Type it again</label>
            <input
              id="password-again"
              name="passwordAgain"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_BYTES}
              autoComplete="new-password"
            />
          </div>
          <SignInButton label="Save password" />
        </form>
      </main>
    </AppShell>
  )
}
