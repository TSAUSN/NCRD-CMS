import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { activityHref, activityLabel, parseActivityCursor, parseActivityFilters } from './activity.ts'

describe('activity history filters', () => {
  it('accepts a single UTC day, but rejects impossible or reversed dates', () => {
    expect(parseActivityFilters({ from: '2026-09-05', to: '2026-09-05' }).error).toBeNull()
    expect(parseActivityFilters({ from: '2026-02-30' }).error).toMatch(/date/)
    expect(parseActivityFilters({ from: '2026-09-06', to: '2026-09-05' }).error).toMatch(/date/)
  })
  it('refuses duplicate filters, invalid identities, and SQL-looking action text', () => {
    expect(parseActivityFilters({ actor: ['a', 'b'] }).error).toMatch(/one/)
    expect(parseActivityFilters({ site: 'not-a-site' }).error).toMatch(/site/)
    expect(parseActivityFilters({ action: "page.publish' OR 1=1" }).error).toMatch(/action/)
  })
  it('retains database microseconds and bigint precision through pagination', () => {
    const value = '2026-09-05T10:00:00.123456Z~9223372036854775807'
    expect(parseActivityCursor(value)).toEqual({ time: '2026-09-05T10:00:00.123456Z', id: '9223372036854775807' })
    expect(parseActivityCursor(value.replace('5807', '5808'))).toBeNull()
    expect(parseActivityCursor('2026-02-30T10:00:00.123456Z~1')).toBeNull()
    expect(parseActivityCursor(`${value}~extra`)).toBeNull()
  })
  it('preserves filters but drops an old cursor when returning to newest activity', () => {
    const { filters } = parseActivityFilters({
      action: 'release.publish',
      from: '2026-09-01',
      before: '2026-09-05T10:00:00.123456Z~5',
    })
    expect(activityHref(filters)).toBe('/activity?action=release.publish&from=2026-09-01')
    expect(
      new URL(activityHref(filters, '2026-09-04T10:00:00.000001Z~2'), 'https://cms.test').searchParams.get('before'),
    ).toBe('2026-09-04T10:00:00.000001Z~2')
    expect(activityLabel('release.publish')).toBe('Published a site release')
    expect(activityLabel('future.new_action')).toBe('Future new action')
  })
  it('names every action the database can record in plain language', () => {
    const directory = new URL('../../../../packages/schema/migrations/', import.meta.url)
    const sql = readdirSync(directory)
      .filter(file => file.endsWith('.sql'))
      .map(file => readFileSync(new URL(file, directory), 'utf8'))
      .join('\n')
    const actions = new Set(
      [...sql.matchAll(/write_audit\([^;]{0,160}?'([a-z_]+(?:\.[a-z_0-9]+)+)'/g)].map(match => match[1]!),
    )
    expect(actions.size).toBeGreaterThan(60)
    for (const action of actions) expect(activityLabel(action), action).not.toMatch(/[._]/)
  })
})
