import { describe, expect, it, vi } from 'vitest'
import { configuredMailer, createResendMailer, MailDeliveryError } from './mail.ts'

const message = {
  to: 'invited@example.test',
  subject: 'Invitation',
  text: 'Open the CMS',
  idempotencyKey: 'cms/test/1',
}
describe('mail delivery transport', () => {
  it('sends a stable idempotency key and returns the provider receipt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'receipt' })))
    expect(await createResendMailer('test-key', 'CMS <cms@example.test>', fetcher).send(message)).toEqual({
      id: 'receipt',
    })
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'Idempotency-Key': message.idempotencyKey },
    })
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      from: 'CMS <cms@example.test>',
      to: [message.to],
      subject: message.subject,
      text: message.text,
    })
  })
  it('refuses non-idempotent sends before contacting the provider', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(
      createResendMailer('key', 'cms@example.test', fetcher).send({ to: message.to, subject: 'x', text: 'x' }),
    ).rejects.toMatchObject({ permanent: true })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    [429, false],
    [503, false],
    [401, true],
    [422, true],
  ] as const)('classifies HTTP %s without exposing private response content', async (status, permanent) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider detail', { status }))
    await expect(createResendMailer('key', 'cms@example.test', fetcher).send(message)).rejects.toEqual(
      new MailDeliveryError(permanent, `Email provider returned HTTP ${status}`),
    )
  })
  it('never silently records a production invitation instead of sending it', async () => {
    await expect(
      configuredMailer({ NODE_ENV: 'production', MAILER_PROVIDER: 'recording' }).send(message),
    ).rejects.toThrow(/not configured/)
  })
  it('keeps unrelated worker jobs available while incomplete mail setup refuses delivery', async () => {
    const mailer = configuredMailer({ NODE_ENV: 'production', MAILER_PROVIDER: 'resend' })
    await expect(mailer.send(message)).rejects.toMatchObject({ permanent: false })
  })
})
