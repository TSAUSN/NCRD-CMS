import { expect, it } from 'vitest'
import { mergeEditedPageMeta, readEditedPageMeta, socialImageProblem } from './page-meta-edit.ts'

it('preserves canonical, social-image and indexing choices when saving inspector text', () => {
  const merged = mergeEditedPageMeta(
    { title: 'Old', canonical: '/about', social_image: '/media/photo', noindex: true },
    { title: 'New', description: 'Changed' },
  )
  expect(merged).toEqual({
    ok: true,
    meta: { title: 'New', description: 'Changed', canonical: '/about', social_image: '/media/photo', noindex: true },
  })
})
it('refuses unknown stored metadata rather than silently discarding it', () => {
  expect(mergeEditedPageMeta({ future: 'keep me' }, { title: 'New', description: '' }).ok).toBe(false)
})

it('round-trips every supported editor field and deliberately clears prior choices', () => {
  const data = new FormData()
  data.set(
    'meta',
    JSON.stringify({
      title: 'About',
      description: 'Our work',
      canonical: '/about',
      social_image: 'https://images.example.org/share.jpg',
      noindex: true,
    }),
  )
  const edit = readEditedPageMeta(data)
  expect(edit.ok).toBe(true)
  if (!edit.ok) return
  const saved = mergeEditedPageMeta({}, edit.fields)
  expect(saved).toEqual({ ok: true, meta: edit.fields })
  const cleared = mergeEditedPageMeta(edit.fields, { canonical: '', social_image: '', noindex: false })
  expect(cleared).toEqual({ ok: true, meta: { ...edit.fields, canonical: '', social_image: '', noindex: false } })
})

it('keeps old two-field clients from resetting indexing or sharing choices', () => {
  const data = new FormData()
  data.set('metaTitle', 'Updated')
  data.set('metaDescription', 'Description')
  const edit = readEditedPageMeta(data)
  expect(edit.ok).toBe(true)
  if (!edit.ok) return
  expect(
    mergeEditedPageMeta({ noindex: true, canonical: '/original', social_image: '/share.jpg' }, edit.fields),
  ).toEqual({
    ok: true,
    meta: {
      title: 'Updated',
      description: 'Description',
      noindex: true,
      canonical: '/original',
      social_image: '/share.jpg',
    },
  })
})

it('refuses malformed, unsupported or falsely typed metadata without coercing it', () => {
  for (const raw of ['{', 'null', '{"noindex":"false"}', '{"json_ld":{}}']) {
    const data = new FormData()
    data.set('meta', raw)
    expect(readEditedPageMeta(data).ok).toBe(false)
  }
})

it('refuses image actions, credentials, hidden authorities and the database length limit', () => {
  for (const value of [
    'javascript:alert(1)',
    'mailto:person@example.org',
    '//evil.example/image',
    '/\\evil.example/image',
    'https://user:password@example.org/image',
    `/${'x'.repeat(2048)}`,
  ]) {
    expect(socialImageProblem(value)).not.toBeNull()
    const data = new FormData()
    data.set('meta', JSON.stringify({ social_image: value }))
    expect(readEditedPageMeta(data).ok).toBe(false)
  }
  for (const value of ['', '/images/share.jpg', 'https://example.org/share.jpg'])
    expect(socialImageProblem(value)).toBeNull()
})
