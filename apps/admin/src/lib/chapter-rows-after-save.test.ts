import { expect, it } from 'vitest'
import { chapterRowsAfterSave } from './chapter-rows-after-save.ts'
import type { ChapterRow } from './chapters.ts'
const row = (id: string, revision: string, boardDisplay = 'first-eight') =>
  ({ id, revision, config: { name: id, boardDisplay } }) as ChapterRow
it('reopens the acknowledged setup before refresh, includes a new chapter and accepts newer server data', () => {
  const old = row('North Texas', '2'),
    saved = row('North Texas', '3', 'all'),
    added = row('Maryland', '1')
  expect(chapterRowsAfterSave([old], [saved, added])).toEqual([added, saved])
  const newer = row('North Texas', '4', 'first-eight')
  expect(chapterRowsAfterSave([newer], [saved])).toEqual([newer])
  expect(chapterRowsAfterSave([saved], [old])).toEqual([saved])
})

it('lists real chapters before bracketed samples so the first detail is a real chapter', () => {
  const sample = row('[A rebuilding chapter]', '1'),
    real = row('Atlanta', '1'),
    later = row('Boston', '1')
  expect(chapterRowsAfterSave([sample, later, real], [])).toEqual([real, later, sample])
  expect(chapterRowsAfterSave([sample], [])).toEqual([sample])
})
