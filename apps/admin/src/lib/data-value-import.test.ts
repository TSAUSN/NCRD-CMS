import { it, expect } from 'vitest'
import { numberFileUrl, previewNumberFile, mergeNumberFile } from './data-value-import.ts'
const row = {
  id: '00000000-0000-4000-8000-000000000001',
  label: 'Projects',
  value: '152',
  unit: '',
  source: 'Report,p.4',
  sourcePageId: null,
  asOf: 'FY2025',
  status: 'matches-report' as const,
  showSource: false,
}
it('previews JSON and quoted CSV without losing stable IDs or silently inheriting a source for a changed value', () => {
  const json = previewNumberFile('[{"label":"Projects","value":158}]', [row])
  expect(json[0]).toMatchObject({ id: row.id, value: '158', source: '', status: 'needs-checking' })
  expect(row.value).toBe('152')
  const csv = previewNumberFile('label,value,source\nProjects,158,"Report, p.4"', [row])
  expect(csv[0]?.source).toBe('Report, p.4')
  expect(mergeNumberFile([row], csv)).toHaveLength(1)
})
it('refuses local,credential-bearing and story-feed addresses and duplicate file rows', () => {
  for (const url of [
    'http://example.test/file',
    'https://person:secret@example.test/file',
    'https://localhost/file',
    'https://127.0.0.1/file',
    'https://sawso.org/sawso/story/symphony/json?start=0',
  ])
    expect(() => numberFileUrl(url)).toThrow()
  expect(numberFileUrl('https://example.test/numbers.json').pathname).toBe('/numbers.json')
  expect(() =>
    previewNumberFile('[{"label":"Projects","value":"158"},{"label":"Projects","value":"160"}]', [row]),
  ).toThrow()
})

it('leaves a fixed number unchanged in a file review', () => {
  const fixed = { ...row, status: 'does-not-change' as const }
  expect(previewNumberFile('[{"label":"Projects","value":"158","source":"Another source"}]', [fixed])).toEqual([fixed])
})
