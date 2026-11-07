import { asUser } from '@cms/platform'
import { ContactMessage } from '@cms/schema'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../components/nav.ts'
import { Card } from '../../../../../components/ui/card.tsx'
import { PageHeader } from '../../../../../components/ui/page-header.tsx'
import { TextLink } from '../../../../../components/ui/text-link.tsx'
import workspace from '../../../../../components/workspace.module.css'
import { UUID } from '../../../../../lib/action-result.ts'
import { getSite, roleLabel } from '../../../../../lib/queries.ts'
import { currentSession } from '../../../../../lib/session.ts'
import styles from './contact-messages.module.css'

export const dynamic = 'force-dynamic'

const pageSize = 25
const timestamp = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
type SavedMessage = { id: string; created_at: Date; message: unknown }

export default async function ContactMessages({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ before?: string }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  if (!UUID.test(siteId)) notFound()
  const { userId, isSuperAdmin, memberships } = session.principal
  if (!isSuperAdmin && memberships.get(siteId) !== 'site_admin') notFound()
  const site = await getSite(userId, siteId)
  if (!site?.chapters_enabled || site.original_design) notFound()
  const { before } = await searchParams
  if (before !== undefined && !UUID.test(before)) notFound()

  const [role, messages] = await Promise.all([
    roleLabel(userId),
    asUser(
      { userId },
      async client =>
        (
          await client.query<SavedMessage>(
            `SELECT id, created_at, message
           FROM contact_messages
          WHERE site_id = $1
            AND ($2::uuid IS NULL OR (created_at, id) < (
              SELECT created_at, id FROM contact_messages WHERE site_id = $1 AND id = $2
            ))
          ORDER BY created_at DESC, id DESC
          LIMIT $3`,
            [siteId, before ?? null, pageSize + 1],
          )
        ).rows,
    ),
  ])
  const visible = messages.slice(0, pageSize)
  const base = '/sites/' + siteId + '/settings'
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + workspace.page}>
        <div className={workspace.denseStack}>
          <PageHeader
            title="Contact messages"
            sub={site.name}
            density="compact"
            showWayfinding={false}
            actions={<TextLink href={base}>Back to General settings</TextLink>}
          />
          <p>
            Messages submitted through this site's contact form are saved here. Email forwarding is not configured. Use
            the contact details below to respond.
          </p>
          {!visible.length && <p>{before ? 'No older messages on this page.' : 'No contact messages yet.'}</p>}
          {visible.map(row => {
            const message = ContactMessage.safeParse(row.message)
            return (
              <Card
                key={row.id}
                title={message.success ? message.data.first_name + ' ' + message.data.last_name : 'Contact message'}
                density="editor"
              >
                <p className="hint">
                  <time dateTime={row.created_at.toISOString()}>{timestamp.format(row.created_at)} UTC</time>
                </p>
                {message.success ? (
                  <>
                    <p className={styles.details}>
                      Email: {message.data.email}
                      <br />
                      Phone: {message.data.phone}
                    </p>
                    <p className={styles.body}>{message.data.comments}</p>
                  </>
                ) : (
                  <p>This saved message is in an unrecognized format.</p>
                )}
              </Card>
            )
          })}
          {messages.length > pageSize && (
            <TextLink href={base + '/contact-messages?before=' + visible.at(-1)!.id}>Older messages</TextLink>
          )}
          {before && <TextLink href={base + '/contact-messages'}>Newest messages</TextLink>}
        </div>
      </main>
    </AppShell>
  )
}
