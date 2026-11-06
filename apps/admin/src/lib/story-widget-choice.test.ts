import { it, expect } from 'vitest'
import {
  WorldChoice,
  worldChoice,
  worldChoiceQuery,
  SplitChoice,
  splitChoice,
  splitChoiceQuery,
} from './story-widget-choice.ts'
it('round-trips bounded choices without accepting executable markup as a region or extra settings', () => {
  const choice = worldChoice(new URLSearchParams('heading=%3Cimg%3E&region=africa&main=health,education&limit=3'))
  expect(worldChoice(worldChoiceQuery(choice))).toEqual(choice)
  for (const input of [
    { ...choice, limit: '999' },
    { ...choice, region: '<script>' },
    { ...choice, main: ['health', 'health'] },
    { ...choice, source: 'https://example.test' },
    { ...choice, heading: 'x'.repeat(161) },
  ])
    expect(() => WorldChoice.parse(input)).toThrow()
})

it('round-trips Split settings with bounded introduction, closed views and fixed Show more steps', () => {
  const choice = splitChoice(
    new URLSearchParams('heading=%3Cimg%3E&introduction=%5BIntroduction%5D&first=sectors&size=6'),
  )
  expect(splitChoice(splitChoiceQuery(choice))).toEqual(choice)
  for (const value of [
    { ...choice, first: 'code' },
    { ...choice, size: '999' },
    { ...choice, introduction: 'x'.repeat(2001) },
    { ...choice, source: 'https://other.test' },
  ])
    expect(() => SplitChoice.parse(value)).toThrow()
})
