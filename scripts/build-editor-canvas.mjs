import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PREVIEW_RUNTIME } from '../packages/renderer/src/preview-runtime.ts'
const tokens = {
  name: 'scope-canvas-tokens',
  setup(b) {
    b.onLoad({ filter: /styles[\\/]tokens\.css$/ }, async args => ({
      contents: (await readFile(args.path, 'utf8')).replaceAll(
        ':root',
        'cms-editor-layer,[data-cms-editor-ghost],[data-cms-editor-list-ghost]',
      ),
      loader: 'css',
      resolveDir: dirname(args.path),
    }))
  },
}
const browserBoundary = {
  name: 'isolated-canvas-browser-boundary',
  setup(b) {
    b.onResolve({ filter: /^(?:next(?:\/|$)|server-only$|node:)/ }, args => ({
      errors: [
        {
          text: `Isolated canvas controls cannot import ${args.path}. Keep routing and server code outside shared canvas controls.`,
        },
      ],
    }))
  },
}
const root = fileURLToPath(new URL('../', import.meta.url))
await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ['apps/admin/src/app/pages/[pageId]/isolated-canvas-prelude.ts'],
    outfile: 'apps/site/public/__cms/editor/prelude.js',
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
  }),
  // Original quirks-mode documents match class names without case. Identifier
  // minification can assign .a and .A to unrelated controls (button/toast).
  build({
    absWorkingDir: root,
    entryPoints: ['apps/admin/src/app/pages/[pageId]/isolated-canvas-runtime.ts'],
    outfile: 'apps/site/public/__cms/editor/preview.js',
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    jsx: 'automatic',
    plugins: [tokens, browserBoundary],
    banner: { js: PREVIEW_RUNTIME },
  }),
])
