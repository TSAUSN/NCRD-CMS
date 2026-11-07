// Capture real public HTML/CSS/assets, private previews and complete SQL schema.
// Only explicitly isolated local fixtures are accepted; artifacts stay private.
import { writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { target, privateDirectory, fixture, applications, schemaSnapshot, localCookie, root } from './golden/local.mjs'
import { publicPages, directPreviews } from './golden/http.mjs'
import { canvasPreviews } from './golden/canvas.mjs'
import { compareSnapshots } from './golden/compare.mjs'
export { compareSnapshots } from './golden/compare.mjs'
const args = process.argv.slice(2)
const option = key => args[args.indexOf(key) + 1]
async function main() {
  if (args[0] === 'compare') {
    if (!args.includes('--before') || !args.includes('--after'))
      throw Error('Supply --before and --after private snapshots.')
    const result = compareSnapshots(resolve(option('--before')), resolve(option('--after')))
    console.log(JSON.stringify(result, null, 2))
    if (!result.byteIdentical) process.exitCode = 1
    return
  }
  if (
    args[0] !== 'capture' ||
    !args.includes('--out') ||
    !args.includes('--media-root') ||
    !args.includes('--canvas-state')
  )
    throw Error(
      'Usage: golden-render.mjs capture --out PRIVATE_EMPTY_DIRECTORY --media-root REVIEWED_MEDIA_DIRECTORY --canvas-state PRIVATE_TICKET_JSON; or compare --before PRIVATE --after PRIVATE.',
    )
  const t = target(),
    out = privateDirectory(option('--out'))
  try {
    readFileSync(join(out, 'render-manifest.json'))
    throw Error('Snapshot already exists. Never overwrite the golden baseline.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const data = await fixture(t),
    stop = await applications(t, out, option('--media-root'))
  try {
    const manifest = {},
      functions = await schemaSnapshot(t, out)
    const assets = await publicPages(t, out, data, manifest)
    const cookie = localCookie(data.owner.email)
    await directPreviews(t, out, data.routes, cookie, manifest)
    const canvases = await canvasPreviews(t, out, data.routes, cookie, manifest, resolve(option('--canvas-state')))
    const summary = {
      at: new Date().toISOString(),
      source: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
      database: t.database,
      ports: t.ports,
      pages: data.routes.length,
      assets,
      previews: data.routes.length * 2,
      isolatedCanvasPreviews: canvases,
      functions,
      normalization:
        'Only pg_dump randomized backslash-restrict transport markers; no HTML/CSS/preview/SQL bytes normalized.',
    }
    writeFileSync(join(out, 'render-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await stop()
  }
}
main().catch(error => {
  console.error(
    String(error.message)
      .split('\n')[0]
      .replace(/https?:\/\/\S+/g, '[private URL omitted]'),
  )
  process.exitCode = 1
})
