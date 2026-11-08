import 'server-only'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

type Runtime = { head: string; body: string; hashes: string[]; styles: boolean }
type CanvasRuntimes = { editing: Runtime; visitor: Runtime }

let loaded: Promise<CanvasRuntimes> | undefined

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest()

async function buildFile(name: 'prelude.js' | 'preview.js' | 'preview.css') {
  const bytes = await readFile(join(process.cwd(), 'public', '__cms', 'editor', name))
  const checksum = digest(bytes)
  const hash = 'sha256-' + checksum.toString('base64')
  // A cached response from an earlier release cannot satisfy today's SRI.
  const path = '/__cms/editor/' + name + '?v=' + checksum.toString('hex')
  const tag = name.endsWith('.css')
    ? `<link rel="stylesheet" href="${path}" integrity="${hash}">`
    : `<script src="${path}" integrity="${hash}"></script>`
  return { bytes, hash, tag }
}

async function readCanvasRuntimes(): Promise<CanvasRuntimes> {
  const [prelude, editor, stylesheet] = await Promise.all([
    buildFile('prelude.js'),
    buildFile('preview.js'),
    buildFile('preview.css'),
  ])
  // The visitor prelude must run before reviewed scripts rewrite private URLs.
  // Shipping the fixed build output in the document removes a blocking fetch.
  // Hash the exact text the HTML parser sees and reject unsafe raw-text output.
  const source = prelude.bytes.toString('utf8').replace(/\r\n?/g, '\n')
  if (/<\/?script(?=[\s/>])|<!--|\0/i.test(source)) throw Error('Invalid canvas prelude output.')
  const visitorHash = 'sha256-' + digest(source).toString('base64')
  return {
    editing: {
      head: stylesheet.tag + prelude.tag,
      body: editor.tag,
      hashes: [prelude.hash, editor.hash],
      styles: true,
    },
    visitor: { head: '<script>' + source + '</script>', body: '', hashes: [visitorHash], styles: false },
  }
}

/** Fixed code-owned paths only. A read-only canvas does not mount editor controls. */
export async function canvasRuntimeFiles(visitor = false): Promise<Runtime> {
  if (!loaded) {
    const attempt = readCanvasRuntimes()
    loaded = attempt
    void attempt.catch(() => {
      if (loaded === attempt) loaded = undefined
    })
  }
  const files = await loaded
  return visitor ? files.visitor : files.editing
}
