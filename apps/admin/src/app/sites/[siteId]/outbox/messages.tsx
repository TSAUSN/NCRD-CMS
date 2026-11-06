'use client'
import { useState } from 'react'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { EmptyState } from '../../../../components/ui/feedback.tsx'
import { reviewTime } from '../../../../lib/review-time.ts'
import type { LocalChapterMail } from '../../../../lib/local-chapter-mail.ts'
import styles from './outbox.module.css'
export function LocalMessages({ items }: { items: LocalChapterMail[] }) {
  const [copied, setCopied] = useState<string | null>(null),
    [fallback, setFallback] = useState<string | null>(null)
  const copy = async (item: LocalChapterMail) => {
    if (!item.link) return
    try {
      await navigator.clipboard.writeText(item.link)
      setCopied(item.id)
      setFallback(null)
    } catch {
      setFallback(item.id)
    }
  }
  return (
    <div className={styles.stack}>
      <p>
        Contact checks and approval reminders are recorded here. Copy a sign-in link into a private browsing window to
        try the chapter editor’s view. Each link works once and expires after 20 minutes.
      </p>
      {!items.length ? (
        <EmptyState title="No messages yet">
          Invite a chapter editor or request a sign-in link to record a message here.
        </EmptyState>
      ) : (
        items.map(item => (
          <Card key={item.id} title={item.subject}>
            <div className={styles.stack}>
              <p className={styles.meta}>
                {item.recipient} · <time dateTime={item.createdAt}>{reviewTime(item.createdAt)}</time>
              </p>
              <MessageBody body={item.body} />
              {item.link && (
                <div className={styles.stack}>
                  <div>
                    <Button variant="secondary" onClick={() => void copy(item)}>
                      Copy sign-in link
                    </Button>
                  </div>
                  {copied === item.id && <p role="status">Link copied. Open it in a private browsing window.</p>}
                  {fallback === item.id && (
                    <label>
                      Sign-in link
                      <input readOnly value={item.link} onFocus={event => event.target.select()} />
                    </label>
                  )}
                </div>
              )}
              {item.expired && <p className={styles.meta}>This sign-in link has expired or has already been used.</p>}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}

function MessageBody({ body }: { body: string }) {
  const match =
    /\n\nCheck my page: (http:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]{2,5})?\/pages\/[a-f0-9-]{36})(?=\n|$)/.exec(body)
  if (!match) return <p className={styles.body}>{body}</p>
  return (
    <div className={styles.stack}>
      <p className={styles.body}>{body.slice(0, match.index)}</p>
      <p>
        <Link href={match[1]!}>Check my page</Link>
      </p>
      <MessageBody body={body.slice(match.index + match[0].length)} />
    </div>
  )
}
