import { signIn } from '../actions/auth.ts'
import { authProvider, currentSession } from '../../lib/session.ts'
import { redirect } from 'next/navigation'
import { EntryPanel } from '../../components/entry.tsx'
import { IconAlert, IconMail, IconClock } from '../../components/icons.tsx'
import { SignInButton } from './submit-button.tsx'
import { ButtonLink } from '../../components/ui/button-link.tsx'
import styles from './sign-in.module.css'

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; reauth?: string }>
}) {
  // Resolved server-side before anything renders, so there is no signed-out
  // flash and no client-side race (SPEC §6.1, D12).
  const { error, sent, reauth } = await searchParams
  if (reauth !== '1' && !error && !sent && (await currentSession())) redirect('/')
  let local = false
  let configured = true
  try {
    local = authProvider().name === 'local'
  } catch {
    configured = false
  }
  const messages: Record<string, string> = {
    'missing-email': 'Enter a valid email address—the one you were invited with.',
    'rate-limit': 'Please wait a minute before requesting another sign-in link.',
    unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
    'expired-link': 'This sign-in link has expired or has already been used. Request a new link below.',
    'no-access':
      'Your email was verified, but you do not have access to this CMS. Ask your site administrator for an invitation.',
  }

  if (configured && sent === '1' && !error)
    return (
      <EntryPanel
        heading={local ? 'Check the local outbox' : 'Check your email'}
        lede={local ? 'Your sign-in request stays in this local demo.' : 'Open the sign-in link in this browser.'}
        beforeHeading={
          <span aria-hidden="true" className={styles.symbol}>
            <IconMail size={20} />
          </span>
        }
      >
        <p role="status" className={styles.receipt}>
          {local
            ? 'If this address has chapter access, its sign-in link is in the local outbox. No email was sent. Ask the demo operator to open your link.'
            : 'If this address has an account, a sign-in link is on its way. Check your inbox and junk folder.'}
        </p>
        <p className={styles.help}>To request another link, enter your email again.</p>
        <ButtonLink variant="secondary" href="/sign-in" className={styles.action}>
          Use a different email
        </ButtonLink>
      </EntryPanel>
    )
  if (configured && error === 'expired-link')
    return (
      <EntryPanel
        heading="That link has expired"
        lede="Request a fresh sign-in link to continue."
        beforeHeading={
          <span aria-hidden="true" className={styles.symbol} data-tone="expired">
            <IconClock size={20} />
          </span>
        }
      >
        <p role="alert" className={styles.receipt}>
          {messages['expired-link']}
        </p>
        <ButtonLink href="/sign-in" className={styles.action}>
          Request a new link
        </ButtonLink>
        <p className="entry-note">Not added to a site yet? Ask your site administrator for an invitation.</p>
      </EntryPanel>
    )
  return (
    <EntryPanel
      heading="Sign in"
      lede={
        local
          ? 'Use a sample staff account, or request your chapter editor’s sign-in link.'
          : 'We’ll email you a link. No password to remember.'
      }
    >
      {error && messages[error] && (
        <p className="notice notice-error" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{messages[error]}</span>
        </p>
      )}
      {!configured && (
        <p className="notice notice-error" role="alert">
          Sign-in has not been set up for this installation yet. Contact the person who manages this CMS.
        </p>
      )}
      <form action={signIn}>
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            disabled={!configured}
            autoComplete="email"
            placeholder="you@example.org"
          />
        </div>
        <SignInButton disabled={!configured} label={local ? 'Continue to local CMS' : 'Send me a link'} />
      </form>
      <p className="entry-note">
        There is no password to remember or lose. Signing in does not by itself give you access to a site — somebody who
        already looks after one has to invite you first.
      </p>
      {local && (
        <details className={styles.local}>
          <summary>About local sign-in</summary>
          <p>
            Sample staff accounts sign in straight away. Chapter editor links are recorded in the local outbox. No email
            is sent.
          </p>
        </details>
      )}
    </EntryPanel>
  )
}
