import { expect, it } from 'vitest'
import { overviewPerson } from './overview-people.ts'
it('omits bracketed and labelled sample people while keeping unlabelled people', () => {
  expect(overviewPerson({ display_name: '[Chapter editor]', email: 'editor@personal.test' })).toBe(false)
  expect(overviewPerson({ display_name: 'Editor (sample)', email: 'editor@personal.test' })).toBe(false)
  expect(overviewPerson({ display_name: 'Root', email: 'root@example.test' })).toBe(true)
  expect(overviewPerson({ display_name: 'Site Editor', email: 'editor@example.test' })).toBe(true)
})
