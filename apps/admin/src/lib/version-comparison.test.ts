import { describe, expect, it } from 'vitest'
import { compareVersions, comparisonText, type ComparisonVersion } from './version-comparison.ts'

const section = (heading: string) => ({ section_def_id: 'hero', section_def_version: 1, values: { heading } })
const version = (content: unknown = [section('Original')]): ComparisonVersion => ({
  page_title: 'Home',
  page_slug: '',
  meta: { description: 'An introduction' },
  content,
})

describe('saved version comparison', () => {
  it('reports an address and title change even when the section content is identical', () => {
    expect(
      compareVersions(version(), { ...version(), page_title: 'About', page_slug: 'about' }).map(change => change.label),
    ).toEqual(['Page name', 'Web address'])
  })
  it('compares repeated sections by position without pretending to match moved instances', () => {
    const changes = compareVersions(version([section('A'), section('B')]), version([section('B'), section('A')]))
    expect(changes).toEqual([
      { label: 'Position 1 · heading', before: 'A', after: 'B' },
      { label: 'Position 2 · heading', before: 'B', after: 'A' },
    ])
  })
  it('keeps removals and empty field values distinct', () => {
    const changes = compareVersions(version(), version([{ ...section(''), values: {} }]))
    expect(changes[0]).toEqual({ label: 'Position 1 · heading', before: 'Original', after: undefined })
    expect(comparisonText(undefined)).not.toBe(comparisonText(''))
  })
  it('ignores object key ordering while preserving meaningful array order', () => {
    const before = version([{ ...section('A'), hidden_at: ['mobile', 'tablet'] }])
    const equal = version([
      { values: { heading: 'A' }, hidden_at: ['mobile', 'tablet'], section_def_version: 1, section_def_id: 'hero' },
    ])
    expect(compareVersions(before, equal)).toEqual([])
    expect(compareVersions(before, version([]))).toHaveLength(1)
  })
})
