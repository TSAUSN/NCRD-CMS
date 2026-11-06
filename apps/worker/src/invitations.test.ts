import { describe, expect, it, vi } from 'vitest'
import { invitationHandler, type InvitationDelivery, type InvitationRepository } from './invitations.ts'
import { PermanentJobError, type OutboxEvent } from './handlers.ts'

const event: OutboxEvent = {
  id: '123',
  site_id: null,
  event_type: 'user.invited',
  payload: { user_id: 'person' },
  attempts: 1,
  lease_token: 'lease',
}
const delivery = (): InvitationDelivery => ({
  recipient: 'invited@example.test',
  subject: 'Invitation',
  body: 'Stored immutable message',
  idempotency_key: 'cms/frozen/123',
  provider_id: null,
  expires_at: new Date(Date.now() + 60_000),
  cancelled: false,
})

describe('invitation delivery', () => {
  it('sends the frozen message and records its receipt under the current lease', async () => {
    const repository: InvitationRepository = { prepare: vi.fn().mockResolvedValue(delivery()), record: vi.fn() }
    const send = vi.fn().mockResolvedValue({ id: 'receipt' })
    await invitationHandler(repository, { send }, 'https://cms.example.test').handle(event)
    expect(send).toHaveBeenCalledWith({
      to: 'invited@example.test',
      subject: 'Invitation',
      text: 'Stored immutable message',
      idempotencyKey: 'cms/frozen/123',
    })
    expect(repository.record).toHaveBeenCalledWith('123', 'lease', 'receipt')
  })
  it.each([{ provider_id: 'already-sent' }, { cancelled: true }])(
    'does not send a completed or cancelled delivery',
    async override => {
      const send = vi.fn()
      await invitationHandler(
        { prepare: vi.fn().mockResolvedValue({ ...delivery(), ...override }), record: vi.fn() },
        { send },
        'https://cms.example.test',
      ).handle(event)
      expect(send).not.toHaveBeenCalled()
    },
  )
  it('stops uncertain retries before the provider idempotency window expires', async () => {
    const send = vi.fn()
    await expect(
      invitationHandler(
        { prepare: vi.fn().mockResolvedValue({ ...delivery(), expires_at: new Date(0) }), record: vi.fn() },
        { send },
        'https://cms.example.test',
      ).handle(event),
    ).rejects.toBeInstanceOf(PermanentJobError)
    expect(send).not.toHaveBeenCalled()
  })
  it('never marks a provider outage as delivered', async () => {
    const record = vi.fn()
    await expect(
      invitationHandler(
        { prepare: vi.fn().mockResolvedValue(delivery()), record },
        { send: vi.fn().mockRejectedValue(new Error('offline')) },
        'https://cms.example.test',
      ).handle(event),
    ).rejects.toThrow('offline')
    expect(record).not.toHaveBeenCalled()
  })
})
