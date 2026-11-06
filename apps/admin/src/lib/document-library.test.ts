import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadSiteDocument } from './document-library.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})
describe('collection PDF selection upload client', () => {
  it('uploads file bytes with the same-origin endpoint contract and returns private metadata', async () => {
    const document = { id: 'document-id', originalName: 'Résumé report.pdf', bytes: 8, url: '/assets/document-id' }
    const fetch = vi.fn(async () => Response.json({ document }, { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const file = new File(['%PDF-1.4'], 'Résumé report.pdf', { type: 'application/pdf' })
    expect(await uploadSiteDocument('site-id', file)).toEqual(document)
    expect(fetch).toHaveBeenCalledWith('/api/sites/site-id/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-document-name': 'R%C3%A9sum%C3%A9%20report.pdf' },
      body: file,
    })
  })
  it('refuses empty, oversized or wrong-extension files without a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const file of [
      new File([], 'empty.pdf'),
      new File(['x'], 'report.html'),
      new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'large.pdf'),
    ]) {
      await expect(uploadSiteDocument('site-id', file)).rejects.toThrow('Choose a PDF')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('surfaces a rejected or uncertain upload rather than inserting a guessed document link', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ error: { message: 'The destination was not found.' } }, { status: 404 }),
    )
    vi.stubGlobal('fetch', fetch)
    const file = new File(['%PDF-1.4'], 'report.pdf')
    await expect(uploadSiteDocument('site-id', file)).rejects.toThrow('destination')
    fetch.mockImplementation(async () => Response.json({}, { status: 201 }))
    await expect(uploadSiteDocument('site-id', file)).rejects.toThrow('could not be confirmed')
  })
})
