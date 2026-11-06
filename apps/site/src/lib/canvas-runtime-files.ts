import 'server-only'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
type Runtime = { head: string; body: string; hashes: string[]; styles: boolean }
let loaded: Promise<{ editing: Runtime; visitor: Runtime }> | undefined
/** Fixed code-owned paths only. Missing build output fails closed. A visitor
 * needs only the private-resource prelude; no editing model or controls. */
export async function canvasRuntimeFiles(visitor = false): Promise<Runtime> {
  const files = await (loaded ??= Promise.all(
    ['prelude.js', 'preview.js', 'preview.css'].map(async name => {
      const bytes = await readFile(join(process.cwd(), 'public', '__cms', 'editor', name)),
        hash = 'sha256-' + createHash('sha256').update(bytes).digest('base64')
      return {
        tag: name.endsWith('.css')
          ? `<link rel="stylesheet" href="/__cms/editor/${name}" integrity="${hash}">`
          : `<script src="/__cms/editor/${name}" integrity="${hash}"></script>`,
        hash,
      }
    }),
  ).then(files => ({
    editing: {
      head: files[2]!.tag + files[0]!.tag,
      body: files[1]!.tag,
      hashes: files.slice(0, 2).map(file => file.hash),
      styles: true,
    },
    visitor: { head: files[0]!.tag, body: '', hashes: [files[0]!.hash], styles: false },
  })))
  return visitor ? files.visitor : files.editing
}
