// The schema facts the rest of the product leans on, asserted against the
// Drizzle definitions so a refactor that drops one fails here — before any
// migration runs. The database side of the same claims lives in
// test/isolation.db.test.ts, which proves them against real Postgres.
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  appUsers,
  auditLog,
  collections,
  domains,
  media,
  pageVersions,
  pages,
  publishedRoutes,
  sectionDefVersions,
  siteMemberships,
} from './index.ts'

type Table = Parameters<typeof getTableConfig>[0]

const uniques = (t: Table) =>
  getTableConfig(t).uniqueConstraints.map(u =>
    u.columns
      .map(c => c.name)
      .sort()
      .join(','),
  )
const columns = (t: Table) => Object.fromEntries(getTableConfig(t).columns.map(c => [c.name, c]))

describe('tenancy is carried on the row, not inferred from a join', () => {
  it.each([
    ['page_versions', pageVersions],
    ['published_routes', publishedRoutes],
  ] as const)('%s carries site_id', (_name, table) => {
    expect(columns(table)['site_id']?.notNull).toBe(true)
  })

  it('page slugs are unique per site, not globally', () => {
    expect(uniques(pages)).toContain('site_id,slug')
  })

  it('collection reader keys are unique per site so slot bindings stay unambiguous', () => {
    expect(uniques(collections)).toContain('reader_key,site_id')
  })

  it('domain hostnames are globally unique — one owner per hostname', () => {
    expect(columns(domains)['hostname_normalized']?.isUnique).toBe(true)
  })
})

describe('versions are immutable and revision-addressed', () => {
  it('a page version number can never repeat within a page', () => {
    expect(uniques(pageVersions)).toContain('page_id,revision')
  })

  it('a section def version number can never repeat within a def', () => {
    expect(uniques(sectionDefVersions)).toContain('section_def_id,version')
  })

  it('the head carries the revision CAS token every mutation must echo', () => {
    expect(columns(pages)['revision']?.notNull).toBe(true)
  })

  it('a section def version pins the policy that checked it', () => {
    expect(columns(sectionDefVersions)['sanitizer_policy_version']?.notNull).toBe(true)
    expect(columns(sectionDefVersions)['render_hash']?.notNull).toBe(true)
  })
})

describe('the boundaries v1 taught us to keep', () => {
  it('page versions carry the trusted-code marker the super-admin gate reads', () => {
    expect(columns(pageVersions)['carries_trusted_code']?.notNull).toBe(true)
    expect(columns(pageVersions)['trusted_code_approved_by']).toBeDefined()
  })

  it('media records alt text and an explicit decorative intent', () => {
    expect(columns(media)['alt_text']?.notNull).toBe(true)
    expect(columns(media)['decorative']?.notNull).toBe(true)
  })

  it('audit entries name an actor type, so system actions cannot borrow a user', () => {
    expect(columns(auditLog)['actor_type']?.notNull).toBe(true)
  })

  it('a user record exists before its login does', () => {
    expect(columns(appUsers)['auth_subject']?.notNull).toBe(false)
    expect(columns(appUsers)['status']?.notNull).toBe(true)
  })

  it('a membership is one row per (user, site)', () => {
    const pk = getTableConfig(siteMemberships).primaryKeys[0]
    expect(pk?.columns.map(c => c.name).sort()).toEqual(['site_id', 'user_id'])
  })
})
