import { it, expect, vi } from 'vitest'
import { readNumberFile, publicNumberAddress } from './number-file-fetch.ts'
it('rejects internal and special IPv4 networks without making a request', async () => {
  for (const ip of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.31.2.3',
    '192.168.1.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '::1',
  ])
    expect(publicNumberAddress(ip)).toBe(false)
  const read = vi.fn()
  await expect(
    readNumberFile('https://numbers.example.test/file', { resolve: async () => ['93.184.216.34', '127.0.0.1'], read }),
  ).rejects.toThrow('public file')
  expect(read).not.toHaveBeenCalled()
})
it('pins the checked address and checks each redirect without permitting the reserved story feed', async () => {
  const resolve = vi.fn(async () => ['93.184.216.34']),
    read = vi.fn(async (url: URL, ip: string) => {
      expect(ip).toBe('93.184.216.34')
      return url.pathname === '/start'
        ? { status: 302, location: '/numbers', contentType: '', body: '' }
        : { status: 200, contentType: 'application/json', body: '[]' }
    })
  expect(await readNumberFile('https://numbers.example.test/start', { resolve, read })).toBe('[]')
  expect(resolve).toHaveBeenCalledTimes(2)
  const blocked = vi.fn(async () => ({
    status: 302,
    location: 'https://sawso.org/sawso/story/symphony/json?start=0',
    contentType: '',
    body: '',
  }))
  await expect(readNumberFile('https://numbers.example.test/start', { resolve, read: blocked })).rejects.toThrow(
    'Stories',
  )
  expect(blocked).toHaveBeenCalledTimes(1)
})
it('refuses an HTML response and an oversized response', async () => {
  const resolve = async () => ['93.184.216.34']
  await expect(
    readNumberFile('https://numbers.example.test/file', {
      resolve,
      read: async () => ({ status: 200, contentType: 'text/html', body: '<p>Not a number file</p>' }),
    }),
  ).rejects.toThrow('JSON or CSV')
  await expect(
    readNumberFile('https://numbers.example.test/file', {
      resolve,
      read: async () => ({ status: 200, contentType: 'text/csv', body: 'x'.repeat(1048577) }),
    }),
  ).rejects.toThrow('1 MB')
})
