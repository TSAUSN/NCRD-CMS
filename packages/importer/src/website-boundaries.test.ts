import { afterEach, describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { importWebsite } from './website.ts'
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'cms-website-boundary-'))
  folders.push(base)
  const root = join(base, 'source'),
    outside = root + '-other'
  mkdirSync(root)
  mkdirSync(outside)
  writeFileSync(
    join(root, 'index.html'),
    '<html><head><title>Safe page</title></head><body><section><h1>Safe page</h1></section></body></html>',
  )
  writeFileSync(join(outside, 'index.html'), '<h1>Outside sentinel</h1>')
  writeFileSync(join(outside, 'private.css'), '.outside:before{content:"outside-content-sentinel"}')
  return { root, outside, base }
}
const options = (root: string) => ({ root, name: 'Local website', slug: 'local-website', pages: ['index.html'] })
describe('local website file boundaries', () => {
  it('refuses page traversal into a prefix-sharing sibling before reading HTML', async () => {
    const { root } = fixture()
    await expect(importWebsite({ ...options(root), pages: ['../source-other/index.html'] })).rejects.toThrow(
      'Choose HTML pages inside the website folder.',
    )
  })
  it('refuses HTML symlinks that lead outside the chosen source folder', async () => {
    const { root, outside } = fixture()
    symlinkSync(join(outside, 'index.html'), join(root, 'linked.html'))
    await expect(importWebsite({ ...options(root), pages: ['linked.html'] })).rejects.toThrow(
      'Choose HTML pages inside the website folder.',
    )
  })
  it('does not read a document or server-side source as an HTML page', async () => {
    const { root } = fixture()
    for (const name of ['notes.md', 'server.php', 'settings.json']) {
      writeFileSync(join(root, name), 'outside-content-sentinel')
      await expect(importWebsite({ ...options(root), pages: [name] })).rejects.toThrow(
        'Choose HTML pages inside the website folder.',
      )
    }
  })
  it('refuses an extra stylesheet outside the chosen folders, including symlink aliases', async () => {
    const { root, outside } = fixture()
    symlinkSync(join(outside, 'private.css'), join(root, 'linked.css'))
    for (const css of ['../source-other/private.css', 'linked.css'])
      await expect(importWebsite({ ...options(root), css: [css] })).rejects.toThrow(
        'Choose stylesheets inside the website or public assets folder.',
      )
  })
  it('does not copy referenced resources from a sibling folder or an escaping symlink', async () => {
    const { root, outside } = fixture(),
      png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#112233' } })
        .png()
        .toBuffer()
    writeFileSync(join(outside, 'photo.png'), png)
    symlinkSync(join(outside, 'photo.png'), join(root, 'linked.png'))
    writeFileSync(
      join(root, 'index.html'),
      '<html><head><title>Safe</title><link rel="stylesheet" href="../source-other/private.css"></head><body><section><h1>Safe</h1><img src="../source-other/photo.png" alt="Outside"><img src="linked.png" alt="Linked"></section></body></html>',
    )
    const result = await importWebsite(options(root))
    expect(result.archive.content.media).toEqual([])
    expect(result.archive.objects).toEqual([])
    expect(JSON.stringify(result)).not.toContain('outside-content-sentinel')
  })
  it('refuses a resource alias that disguises a server-side file inside the source folder', async () => {
    const { root } = fixture()
    writeFileSync(join(root, 'private.php'), '.picture:before{content:"outside-content-sentinel"}')
    symlinkSync(join(root, 'private.php'), join(root, 'linked.css'))
    writeFileSync(
      join(root, 'index.html'),
      '<html><head><title>Safe</title><link rel="stylesheet" href="linked.css"></head><body><section class="picture"><h1>Safe</h1></section></body></html>',
    )
    const result = await importWebsite(options(root))
    expect(JSON.stringify(result)).not.toContain('outside-content-sentinel')
  })
  it('keeps in-folder stylesheet symlink URLs relative to their linked address', async () => {
    const { root } = fixture()
    for (const directory of ['css', 'images', 'deep/nested']) mkdirSync(join(root, directory), { recursive: true })
    writeFileSync(
      join(root, 'images', 'ok.png'),
      await sharp({ create: { width: 4, height: 4, channels: 3, background: '#224466' } })
        .png()
        .toBuffer(),
    )
    writeFileSync(join(root, 'deep/nested', 'real.css'), '.picture{background-image:url("../images/ok.png")}')
    symlinkSync(join(root, 'deep/nested', 'real.css'), join(root, 'css', 'linked.css'))
    writeFileSync(
      join(root, 'index.html'),
      '<html><head><title>Safe</title><link rel="stylesheet" href="css/linked.css"></head><body><section class="picture"><h1>Safe</h1></section></body></html>',
    )
    const result = await importWebsite(options(root))
    expect(result.archive.content.media).toHaveLength(1)
    expect(result.report.media.missing).toEqual([])
  })
})
