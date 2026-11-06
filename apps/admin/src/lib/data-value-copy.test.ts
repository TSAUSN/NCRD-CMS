import { it, expect } from 'vitest'
import { dataValueChangeWords } from './data-value-copy.ts'
it('states saved old and new numbers,source and distinct affected pages in ordinary words', () => {
  const id = '00000000-0000-4000-8000-000000000001',
    row = {
      id,
      label: 'Projects',
      value: '152',
      unit: '',
      source: 'Annual report,p.4',
      sourcePageId: null,
      asOf: 'FY2025',
      status: 'matches-report',
      showSource: false,
    },
    result = dataValueChangeWords(
      { dataValues: [row] },
      { dataValues: [{ ...row, value: '158' }] },
      {
        [id]: [
          { id: 'home', title: 'Home' },
          { id: 'about', title: 'About Us' },
        ],
      },
    )
  expect(result.words).toEqual(['Projects changed from 152 to 158 · 2 pages'])
  expect(result.cells[0]?.before).toContain('152')
  expect(result.cells[0]?.after).toContain('158')
  expect(result.cells[1]?.after).toBe('Home, About Us')
})
