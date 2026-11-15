import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DomainCard } from './domain-card.tsx'
import type { DomainRow } from '../../../../lib/domains.ts'

vi.mock('../../../../components/guarded-link.tsx', () => ({
  GuardedLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
const row: DomainRow = {
  id: 'fixture-domain',
  hostname_normalized: 'test.example.org',
  kind: 'primary',
  status: 'pending_dns',
  revision: '1',
  dns_records: null,
  last_checked_at: null,
  error_detail: null,
  removed_at: null,
  redirect_hostname: null,
  events: [],
}
const render = (changes: Partial<DomainRow>) =>
  renderToStaticMarkup(
    <DomainCard row={{ ...row, ...changes }} feedback={() => {}}>
      {null}
    </DomainCard>,
  )

it('does not tell a person to change DNS before the hosting provider has returned instructions', () => {
  const html = render({})
  expect(html).toContain('Preparing DNS instructions')
  expect(html).toContain('Keep your existing DNS records')
  expect(html).toContain('does not retry failed background work')
  expect(html).not.toContain('DNS records for test.example.org')
  expect(html).not.toContain('HTTPS is ready')
})

it('keeps Add and Remove records distinct, preserves long values and makes each copy action identifiable', () => {
  const value = 'quoted-verification-value'.repeat(30)
  const html = render({
    dns_records: [
      { type: 'TXT', name: '_cms-verify.test.example.org', value },
      { type: 'A', name: 'test.example.org', value: '192.0.2.1', action: 'REMOVE' },
    ],
  })
  expect(html).toContain(value)
  expect(html).toContain('Copy TXT value for _cms-verify.test.example.org')
  expect(html).toContain('Remove')
  expect(html).toContain('Add')
})

it('distinguishes certificate preparation, a live address and removal without claiming success early', () => {
  expect(render({ status: 'issuing_cert' })).toContain('HTTPS is being prepared')
  const live = render({ status: 'live' })
  expect(live).toContain('HTTPS is ready')
  expect(live.match(/data-complete="true"/g)).toHaveLength(3)
  const removed = render({ status: 'removed', removed_at: '2026-11-15T15:00:00Z' })
  expect(removed).toContain('Removed')
  expect(removed).not.toContain('Connection progress')
})
