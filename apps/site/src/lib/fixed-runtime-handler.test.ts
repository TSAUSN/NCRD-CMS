import { it, expect } from 'vitest'
import { fixedRuntimeFile, fixedRuntimeTag } from '@cms/renderer'
import { serveFixedRuntime } from './fixed-runtime-handler.ts'
it('serves only exact code-owned files with correct type and HEAD semantics', async () => {
  const tag = fixedRuntimeTag('faq', true),
    name = /src="[^"]+\/([^/\"]+)"/.exec(tag)![1]!,
    file = fixedRuntimeFile(name)!,
    request = new Request('https://site.test/__cms/runtime/' + name)
  const response = serveFixedRuntime(request, name)
  expect(await response.text()).toBe(file.source)
  expect(response.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('cache-control')).toContain('immutable')
  expect(serveFixedRuntime(new Request(request, { method: 'HEAD' }), name).body).toBeNull()
  for (const unknown of ['faq.js', '../../secret', name + 'x']) {
    const response = serveFixedRuntime(request, unknown)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
})
