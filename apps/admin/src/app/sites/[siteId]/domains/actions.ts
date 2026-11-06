'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@cms/domain'
import { asUser, domainHostname } from '@cms/platform'
import { currentSession, authProvider } from '../../../../lib/session.ts'
import { recentlyAuthenticated } from '../../../../lib/people.ts'
import { localDomainsUnavailable, LOCAL_DOMAIN_GUIDANCE } from '../../../../lib/domain-setup.ts'

type DomainCommand =
  | { action: 'add'; siteId: string; hostname: string; withWww: boolean }
  | { action: 'check' | 'primary' | 'remove'; siteId: string; id: string; revision: string; confirmation?: string }
export async function changeDomain(input: DomainCommand): Promise<{ ok: boolean; message: string }> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before managing domains.' }
  if (!session.principal.isSuperAdmin) return { ok: false, message: 'Only a Super Admin can manage domains.' }
  if ((input.action === 'add' || input.action === 'check') && localDomainsUnavailable()) {
    return { ok: false, message: LOCAL_DOMAIN_GUIDANCE }
  }
  if (input.action === 'remove' && authProvider().name !== 'local' && !recentlyAuthenticated(session.authenticatedAt)) {
    return { ok: false, message: 'Confirm your sign-in in another tab before removing this address.' }
  }
  try {
    let host: string | undefined
    if (input.action === 'add') {
      try {
        host = domainHostname(input.hostname)
      } catch {
        return { ok: false, message: 'Enter a public hostname without a protocol, port or path.' }
      }
    }
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      if (input.action === 'add')
        await client.query('SELECT app.add_domain($1,$2,$3)', [input.siteId, host, input.withWww])
      else if (input.action === 'check') await client.query('SELECT app.check_domain($1)', [input.id])
      else if (input.action === 'primary')
        await client.query('SELECT app.set_primary_domain($1,$2)', [input.id, input.revision])
      else if (input.action === 'remove')
        await client.query('SELECT app.remove_domain($1,$2,$3)', [input.id, input.revision, input.confirmation])
      else throw new DomainError('invalid_state', 'Choose a domain action.')
    })
    revalidatePath(`/sites/${input.siteId}/domains`)
    return {
      ok: true,
      message:
        input.action === 'add'
          ? 'Address reserved. The worker will request your DNS records shortly.'
          : input.action === 'check'
            ? 'Verification queued. Refresh shortly for the latest DNS and certificate status.'
            : input.action === 'remove'
              ? 'Routing revoked. Certificate cleanup will continue in the background.'
              : 'Primary address updated. Other connected addresses redirect here.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The domain change could not be confirmed. Reload its status before trying again.',
    }
  }
}
