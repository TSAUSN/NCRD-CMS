import { expect, it } from 'vitest'
import { isCommandSearchKey, searchLabel } from './command-search-model.ts'
it('opens with either platform shortcut without intercepting typing, Alt or composition', () => {
  const key = { key: 'k', metaKey: false, ctrlKey: false, altKey: false }
  expect(isCommandSearchKey(key)).toBe(false)
  expect(isCommandSearchKey({ ...key, metaKey: true })).toBe(true)
  expect(isCommandSearchKey({ ...key, key: 'K', ctrlKey: true })).toBe(true)
  expect(isCommandSearchKey({ ...key, metaKey: true, altKey: true })).toBe(false)
  expect(isCommandSearchKey({ ...key, ctrlKey: true, isComposing: true })).toBe(false)
})
it('shows a complete readable label without using an internal item key as fallback', () => {
  expect(searchLabel('<p>Avery <strong>Brooks</strong></p>')).toBe('Avery Brooks')
  expect(searchLabel('  ')).toBe('Untitled item')
  expect(searchLabel({ title: 'key' })).toBe('Untitled item')
  expect(searchLabel('A'.repeat(500))).toHaveLength(500)
})
