import { describe, expect, it } from 'vitest'
import { createLocalAuthProvider } from './session.ts'

const provider = createLocalAuthProvider('a-development-secret-value')

describe('the local auth provider is a real signature, not a placeholder', () => {
  it('round-trips a verified subject', async () => {
    const token = await provider.issue({ subject: 'auth|1', email: 'a@example.test' })
    expect(await provider.verify(token)).toEqual({ subject: 'auth|1', email: 'a@example.test' })
  })

  it('refuses a tampered payload', async () => {
    const token = await provider.issue({ subject: 'auth|1', email: 'a@example.test' })
    const forged = Buffer.from(JSON.stringify({ subject: 'auth|2', email: 'b@example.test' })).toString('base64url')
    expect(await provider.verify(`${forged}.${token.slice(token.lastIndexOf('.') + 1)}`)).toBeNull()
  })

  it('refuses a token signed with a different secret', async () => {
    const other = createLocalAuthProvider('a-completely-different-secret')
    const token = await other.issue({ subject: 'auth|1', email: 'a@example.test' })
    expect(await provider.verify(token)).toBeNull()
  })

  it.each([null, undefined, '', 'no-dot', '.', 'garbage.signature'])('refuses %p', async token => {
    expect(await provider.verify(token)).toBeNull()
  })

  it('refuses a secret too short to be one', () => {
    expect(() => createLocalAuthProvider('short')).toThrow(/at least 16/)
  })
})
