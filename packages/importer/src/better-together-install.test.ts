import { describe, it, expect } from 'vitest'
import { mergeBetterTogetherBindings, installBetterTogetherPages } from './better-together-install.ts'
const file = (fileId: string, pages = ['home']) => ({ fileId, pages })
describe('BT2027 page-scoped ordered file merge', () => {
  it('preserves each page cascade while sharing identical files', () => {
    const result = mergeBetterTogetherBindings(
      [file('base'), file('home'), file('icons')],
      [file('base', ['hotel']), file('hotel', ['hotel']), file('icons', ['hotel'])],
    )
    expect(result.filter(row => row.pages.includes('home')).map(row => row.fileId)).toEqual(['base', 'home', 'icons'])
    expect(result.filter(row => row.pages.includes('hotel')).map(row => row.fileId)).toEqual(['base', 'hotel', 'icons'])
    expect(result.find(row => row.fileId === 'base')!.pages).toEqual(['home', 'hotel'])
  })
  it('refuses incompatible original orders instead of changing behavior', () => {
    expect(() =>
      mergeBetterTogetherBindings([file('one'), file('two')], [file('two', ['other']), file('one', ['other'])]),
    ).toThrow(/orders conflict/)
  })
  it('keeps all-page bindings and distinct loading positions honest', () => {
    expect(mergeBetterTogetherBindings([file('base', [])], [file('base', ['hotel'])])).toEqual([file('base', [])])
    expect(
      mergeBetterTogetherBindings(
        [{ ...file('code'), position: 'head' }],
        [{ ...file('code', ['hotel']), position: 'body-end' }],
      ),
    ).toHaveLength(2)
  })
  it('requires explicit review before touching a database or storage', async () => {
    await expect(
      installBetterTogetherPages({ client: null!, store: null!, siteId: 'none', archives: [], reviewed: false }),
    ).rejects.toThrow(/Review each/)
  })
})
