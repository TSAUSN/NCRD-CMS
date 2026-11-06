import { expect, it } from 'vitest'
import { withoutUnavailablePictures } from './unavailable-pictures.ts'
const id = '11111111-1111-4111-a111-111111111111'
const file = { id, kind: 'image', name: 'good.png', source: 'local:good.png', bytes: 10, sha256: 'a'.repeat(64) }
const projection = {
  versionId: id,
  files: [file],
  bundle: {
    version: 1,
    files: [id],
    styles: [],
    scripts: [],
    paths: [{ path: '/images/good.png', fileId: id }],
    original: { version: 1, definitions: [], pages: [] },
  },
}
it('keeps reviewed images and governed media byte-for-byte, and removes missing/empty images only', () => {
  const valid = '<img class="photo" src="/images/good.png" alt="Good"><img src="/media/' + id + '/wide" alt="Media">'
  const html =
    '<section data-exact="yes">' +
    valid +
    '<img src="/images/missing.png" alt="Unavailable"><img src="" alt="Empty"><p>Keep me</p></section>'
  expect(withoutUnavailablePictures(html, projection)).toBe(
    '<section data-exact="yes">' + valid + '<p>Keep me</p></section>',
  )
})
it('resolves relative imported paths and prevents missing srcset requests', () => {
  expect(
    withoutUnavailablePictures('<img src="images/good.png" srcset="/images/missing.png 2x" alt="Good">', projection),
  ).toBe('<img src="images/good.png"  alt="Good">')
  expect(withoutUnavailablePictures('<img src="../missing.png">', projection, '/nested/page')).toBe('')
})
it('does not invent availability decisions without an original bundle', () => {
  expect(withoutUnavailablePictures('<img src="/photo.jpg"><img src="">', undefined)).toBe('<img src="/photo.jpg">')
})
