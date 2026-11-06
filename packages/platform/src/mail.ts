import type { Mailer } from './ports.ts'
import { createRecordingMailer } from './local/index.ts'

export class MailDeliveryError extends Error {
  readonly permanent: boolean
  constructor(permanent: boolean, message: string) {
    super(message)
    this.name = 'MailDeliveryError'
    this.permanent = permanent
  }
}

/** Resend is an optional transport behind Mailer, not an account dependency for
 * local development. A send-only API key belongs only in the worker process. */
export function createResendMailer(apiKey: string, from: string, fetcher: typeof fetch = fetch): Mailer {
  if (!apiKey || /\s/.test(apiKey) || !from || /[\r\n]/.test(from))
    throw new Error('Configure RESEND_API_KEY and MAIL_FROM')
  return {
    async send(message) {
      if (!message.idempotencyKey || !/^[a-zA-Z0-9_/-]{1,256}$/.test(message.idempotencyKey)) {
        throw new MailDeliveryError(true, 'Email delivery needs a stable idempotency key')
      }
      let response: Response
      try {
        response = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': message.idempotencyKey,
          },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        })
      } catch {
        throw new MailDeliveryError(false, 'Email provider is unavailable; delivery will retry')
      }
      if (!response.ok)
        throw new MailDeliveryError(
          response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status),
          `Email provider returned HTTP ${response.status}`,
        )
      let result: { id?: unknown }
      try {
        result = (await response.json()) as typeof result
      } catch {
        throw new MailDeliveryError(false, 'Email provider returned an unreadable receipt')
      }
      if (!result || typeof result.id !== 'string' || !result.id)
        throw new MailDeliveryError(false, 'Email provider did not return a receipt')
      return { id: result.id }
    },
  }
}

export function configuredMailer(env: Record<string, string | undefined> = process.env): Mailer {
  if (env['MAILER_PROVIDER'] === 'resend') {
    try {
      return createResendMailer(env['RESEND_API_KEY'] ?? '', env['MAIL_FROM'] ?? '')
    } catch {
      return {
        async send() {
          throw new MailDeliveryError(false, 'Configure RESEND_API_KEY and MAIL_FROM on the worker')
        },
      }
    }
  }
  if (
    env['MAILER_PROVIDER'] === 'recording' &&
    (env['NODE_ENV'] !== 'production' || env['CMS_LOCAL_TEST_MODE'] === 'true')
  ) {
    return createRecordingMailer()
  }
  if (!env['MAILER_PROVIDER'] && env['NODE_ENV'] !== 'production') return createRecordingMailer()
  // Missing setup cannot masquerade as successful delivery.
  return {
    async send() {
      throw new MailDeliveryError(false, 'Email delivery is not configured on this worker')
    },
  }
}
