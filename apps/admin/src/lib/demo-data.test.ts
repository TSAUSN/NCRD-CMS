vi.mock('server-only', () => ({}))
import { it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { DEMO_SITES, reviewedDemoArchive, demoReadinessOverride } from '../../scripts/demo-data.ts'
it('preserves the exact reviewed original BT2027 fixture and refuses changed bytes', () => {
  const site = DEMO_SITES.find(site => site.slug === 'bt2027-r8')!,
    bytes = readFileSync(new URL('../../../../demo/sites/' + site.file, import.meta.url))
  expect(site.slug).toBe('bt2027-r8')
  expect(reviewedDemoArchive(site, bytes)).toBe(true)
  expect(() => reviewedDemoArchive(site, Buffer.concat([bytes, Buffer.from('changed')]))).toThrow(/changed/)
  expect(reviewedDemoArchive(DEMO_SITES.find(site => site.slug === 'hni')!, bytes)).toBe(false)
  const archive = JSON.parse(gunzipSync(bytes).toString()),
    active = archive.content.pages.filter((page: { archived_at: string | null }) => !page.archived_at)
  expect(active).toHaveLength(9)
  expect(archive.content.collections.map((list: { name: string }) => list.name).sort()).toEqual([
    'Speakers',
    'Sponsors',
    'Workshops',
  ])
  expect(archive.content.site_files).toHaveLength(115)
  expect(archive.content.site_file_versions.at(-1).bundle.original.newPages).toEqual({
    html: { lang: 'en' },
    body: {},
    header: true,
    footer: true,
    quirks: false,
  })
  expect(DEMO_SITES.some(site => (site.slug as string) === 'event-example')).toBe(false)
})
it('records only the reviewed source heading/image exceptions and refuses new findings or ordinary-site overrides', () => {
  const check = (rule: string, title = 'Manifesto') => [
    { title, report: { blocking: [{ rule, message: 'Fixture finding' }] } },
  ]
  expect(demoReadinessOverride(DEMO_SITES.find(site => site.slug === 'bt2027-r8')!, check('missing_h1'))).toContain(
    'Reviewed original BT2027 local fixture',
  )
  expect(() => demoReadinessOverride(DEMO_SITES.find(site => site.slug === 'hni')!, check('missing_h1'))).toThrow(
    /blocking findings/,
  )
  expect(() =>
    demoReadinessOverride(DEMO_SITES.find(site => site.slug === 'bt2027-r8')!, check('broken_link')),
  ).toThrow(/blocking findings/)
  expect(() =>
    demoReadinessOverride(DEMO_SITES.find(site => site.slug === 'bt2027-r8')!, check('missing_h1', 'New page')),
  ).toThrow(/blocking findings/)
  expect(demoReadinessOverride(DEMO_SITES.find(site => site.slug === 'bt2027-r8')!, [])).toBe('')
})

it('leads with the checked offline SAWSO photo pack and permits only labelled sample findings', () => {
  const site = DEMO_SITES[0],
    bytes = readFileSync(new URL('../../../../demo/sites/' + site.file, import.meta.url))
  expect(site.slug).toBe('sawso')
  expect(reviewedDemoArchive(site, bytes)).toBe(true)
  const archive = JSON.parse(gunzipSync(bytes).toString())
  expect(archive.format).toBe('cms-demo-media-v1')
  expect(archive.photos).toHaveLength(40)
  expect(new Set(archive.photos.map((photo: { source: string }) => photo.source)).size).toBe(40)
  expect(
    demoReadinessOverride(site, [
      { title: 'Story', report: { blocking: [{ rule: 'sample_content', message: 'Sample body' }] } },
    ]),
  ).toBe('Confirmed: Publish with sample content.')
  expect(() =>
    demoReadinessOverride(site, [
      { title: 'Story', report: { blocking: [{ rule: 'broken_link', message: 'Invalid destination' }] } },
    ]),
  ).toThrow(/blocking findings/)
})
