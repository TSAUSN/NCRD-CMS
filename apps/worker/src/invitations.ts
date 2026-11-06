import { configuredMailer, MailDeliveryError, type Mailer } from '@cms/platform'
import type { Pool } from 'pg'
import { createHash } from 'node:crypto'
import { PermanentJobError, withWorkerSession, type EventHandler } from './handlers.ts'

export type InvitationDelivery = {
  recipient: string
  subject: string
  body: string
  idempotency_key: string
  provider_id: string | null
  expires_at: Date
  cancelled: boolean
}
export type InvitationRepository = {
  prepare(eventId: string, lease: string, subject: string, body: string, key: string): Promise<InvitationDelivery>
  record(eventId: string, lease: string, providerId: string): Promise<void>
}

export function invitationHandler(repository: InvitationRepository, mailer: Mailer, adminOrigin: string): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event) {
      let origin: URL
      try {
        origin = new URL(adminOrigin)
      } catch {
        throw new Error('Configure ADMIN_ORIGIN before delivering invitations')
      }
      if (
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash ||
        (origin.protocol !== 'https:' &&
          !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))
      ) {
        throw new Error('ADMIN_ORIGIN must be an HTTPS origin or local development origin')
      }
      if (typeof event.payload['user_id'] !== 'string')
        throw new PermanentJobError('Invitation has no account reference')
      const delivery = await repository.prepare(
        event.id,
        event.lease_token,
        'You have been invited to the CMS',
        `You have been given access to the CMS. Open ${origin.origin}/sign-in and enter the email address that received this invitation. ` +
          'We will send a one-time sign-in link. The sites and permissions assigned to you will appear after you sign in.\n\n' +
          'If you were not expecting this invitation, you can ignore it.',
        `cms/${createHash('sha256').update(origin.origin).digest('hex').slice(0, 16)}/invitation/${event.id}`,
      )
      if (delivery.provider_id || delivery.cancelled) return
      // Resend retains keys for 24 hours. After 23 hours an unknown receipt
      // needs operator review, not a retry that could send the email twice.
      if (delivery.expires_at.getTime() <= Date.now()) {
        throw new PermanentJobError(
          'Invitation delivery is uncertain beyond the safe retry window. Check the email provider, then resend if needed.',
        )
      }
      try {
        const receipt = await mailer.send({
          to: delivery.recipient,
          subject: delivery.subject,
          text: delivery.body,
          idempotencyKey: delivery.idempotency_key,
        })
        await repository.record(event.id, event.lease_token, receipt.id)
      } catch (error) {
        if (error instanceof MailDeliveryError && error.permanent) throw new PermanentJobError(error.message)
        throw error
      }
    },
  }
}

export function createInvitationHandler(
  pool: Pool,
  workerId: string,
  env: Record<string, string | undefined> = process.env,
): EventHandler {
  const repository: InvitationRepository = {
    prepare(eventId, lease, subject, body, key) {
      return withWorkerSession(
        pool,
        workerId,
        async client =>
          (
            await client.query<InvitationDelivery>('SELECT * FROM app.prepare_invitation_email($1,$2,$3,$4,$5)', [
              eventId,
              lease,
              subject,
              body,
              key,
            ])
          ).rows[0]!,
      )
    },
    async record(eventId, lease, providerId) {
      await withWorkerSession(pool, workerId, client =>
        client.query('SELECT app.record_invitation_delivery($1,$2,$3)', [eventId, lease, providerId]),
      )
    },
  }
  return invitationHandler(
    repository,
    configuredMailer(env),
    env['ADMIN_ORIGIN'] ?? (env['NODE_ENV'] === 'production' ? '' : 'http://localhost:3000'),
  )
}

export function unconfiguredInvitationHandler(): EventHandler {
  return {
    idempotency: 'guarded',
    async handle() {
      throw new Error('Invitation delivery is not configured on this worker')
    },
  }
}
