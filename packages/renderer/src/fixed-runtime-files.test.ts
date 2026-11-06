import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { fixedRuntimeFile, fixedRuntimeTag, type FixedRuntimeName } from './fixed-runtime-files.ts'
describe('external fixed widget files', () => {
  it.each(['faq', 'schedule', 'embed', 'hero', 'stories', 'chapters', 'navigation'] as FixedRuntimeName[])(
    'uses exactly the existing %s bytes and an immutable hash address',
    name => {
      const tag = fixedRuntimeTag(name, true),
        src = /src="([^"]+)"/.exec(tag)![1]!,
        file = fixedRuntimeFile(src.split('/').at(-1)!)!
      expect(file.name).toBe(name)
      expect(file.integrity).toBe('sha256-' + createHash('sha256').update(file.source).digest('base64'))
      expect(file.file).toBe(`${name}.${createHash('sha256').update(file.source).digest('base64url')}.js`)
      expect(tag).toBe(`<script src="/__cms/runtime/${file.file}" integrity="${file.integrity}"></script>`)
      expect(fixedRuntimeTag(name, false)).toBe(`<script>${file.source}</script>`)
      expect(fixedRuntimeFile(file.file + '?source=other')).toBeNull()
      expect(fixedRuntimeFile('../' + file.file)).toBeNull()
      expect(fixedRuntimeFile(file.file.replace(/\.js$/, '.changed.js'))).toBeNull()
    },
  )
})
