import { expect, it, vi } from 'vitest'
import { createContactHandler } from './contact-handler.ts'
const values = {
  first_name: '[Name]',
  last_name: '[Name]',
  email: 'visitor@example.test',
  phone: '123',
  comments: '[Message]',
  page: '/',
}
function fixture() {
  const submit = vi.fn(async () => {}),
    feedback = vi.fn(
      async (_request: Request, _host: string, _path: string, context: unknown, status: number) =>
        new Response(JSON.stringify(context), { status }),
    )
  return { submit, feedback, handle: createContactHandler({ host: () => 'sample.test', submit, feedback }) }
}
const request = (body: Record<string, string>, origin = 'http://sample.test') =>
  new Request('http://sample.test/__cms/contact', {
    method: 'POST',
    headers: { host: 'sample.test', origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
it('saves a bounded message, deduplicates retries and redirects without putting personal data in the URL', async () => {
  const f = fixture(),
    response = await f.handle(request(values))
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/?contact=sent#contact')
  expect(f.submit).toHaveBeenCalledWith(
    'sample.test',
    '/',
    expect.objectContaining({ email: values.email }),
    expect.stringMatching(/^[a-f0-9]{64}$/),
  )
  const first = f.submit.mock.calls[0]
  await f.handle(request(values))
  expect(f.submit.mock.calls[1]).toEqual(first)
})
it('refuses another origin, preserves invalid input and does not store honeypot submissions', async () => {
  const f = fixture()
  expect((await f.handle(request(values, 'https://other.test'))).status).toBe(403)
  expect(f.submit).not.toHaveBeenCalled()
  expect((await f.handle(request({ ...values, email: 'invalid' }))).status).toBe(422)
  expect(f.feedback).toHaveBeenCalledWith(
    expect.anything(),
    'sample.test',
    '/',
    expect.objectContaining({ contactValues: expect.objectContaining({ email: 'invalid' }) }),
    422,
  )
  expect((await f.handle(request({ ...values, website: 'spam' }))).status).toBe(303)
  expect(f.submit).not.toHaveBeenCalled()
})
it('bounds encoded request bodies and preserves data when storage is unavailable', async () => {
  const f = fixture()
  expect((await f.handle(request({ ...values, comments: 'x'.repeat(70000) }))).status).toBe(413)
  f.submit.mockRejectedValueOnce(new Error('unavailable'))
  expect((await f.handle(request(values))).status).toBe(503)
})
