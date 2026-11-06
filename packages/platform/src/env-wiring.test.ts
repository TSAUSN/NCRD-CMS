// Verification has to be reproducible from a fresh shell (SPEC §2, §9).
//
// The .env wiring is split in two because Node refuses --env-file inside
// NODE_OPTIONS: package.json entrypoints pass the flag, and config files that
// cannot pass a flag import scripts/load-env.ts. Both mechanisms let an
// existing environment variable win, so CI — which sets them directly — is
// untouched.
//
// A split mechanism rots exactly where it matters: someone adds a command or a
// config and wires only one half, and the failure is "the database tests do not
// run on my machine" long after the change. So this enumerates the files by
// glob rather than by a list, and fails when something new is unwired.
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

/** Every vitest / playwright / next config in the workspace, found not listed. */
function configFiles(): string[] {
  return globSync(
    ['{apps,packages}/*/vitest*.config.ts', '{apps,packages}/*/next.config.ts', 'e2e/playwright.config.ts'],
    { cwd: REPO },
  ).map(p => p.replaceAll('\\', '/'))
}

/** Every package.json script that invokes node directly. */
function directNodeScripts(): { file: string; name: string; command: string }[] {
  const found: { file: string; name: string; command: string }[] = []
  for (const file of globSync(['package.json', '{apps,packages}/*/package.json'], { cwd: REPO })) {
    const pkg = JSON.parse(read(file)) as { scripts?: Record<string, string> }
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      // `node --flags entry.ts` — the commands that run outside a bundler and
      // therefore cannot pick up a config-file import.
      if (/^node\s/.test(command)) found.push({ file: file.replaceAll('\\', '/'), name, command })
    }
  }
  return found
}

describe('every config that can load .env does', () => {
  const configs = configFiles()

  it('finds the configs by glob, so a new one cannot be missed', () => {
    expect(configs.length).toBeGreaterThan(5)
  })

  it.each(configFiles())('%s imports the shared loader', file => {
    expect(read(file)).toMatch(/import ['"][./]+scripts\/load-env\.ts['"]/)
  })
})

describe('every direct node entrypoint declares its environment boundary', () => {
  const scripts = directNodeScripts()

  it('finds the entrypoints by glob', () => {
    expect(scripts.length).toBeGreaterThan(3)
  })

  it.each(directNodeScripts().map(s => [`${s.file} → ${s.name}`, s] as const))(
    '%s passes --env-file-if-exists',
    (_label, script) => {
      // check-node.mjs runs before any env is needed and deliberately takes no
      // configuration, and demo.mjs sets a complete environment of its own so a
      // developer's hosted settings cannot leak into the demo; everything else
      // must see .env.
      // These two tools must not inherit hosted settings. Assert their stricter
      // boundary positively rather than pretending they are application servers.
      if (script.file === 'packages/importer/package.json' && ['bt-homepage', 'bt-page'].includes(script.name)) {
        expect(script.command).not.toContain('--env-file')
        expect(script.command).toContain('src/better-together-cli.ts')
        const entry = read('packages/importer/src/better-together-cli.ts')
        const converter = read('packages/importer/src/better-together.ts')
        for (const source of [entry, converter])
          expect(source).not.toMatch(
            /process\.env|loadEnvFile|load-env|dotenv|\bfetch\(|from ['"](?:node:)?(?:https?|net|pg)['"]|child_process/,
          )
        // Compare without whitespace so formatting never changes the result.
        const compact = (text: string) => text.replace(/\s+/g, '')
        expect(compact(entry)).toContain('process.argv.slice(2)')
        expect(compact(entry)).toContain("readFileSync(resolve(html),'utf8')")
        expect(compact(converter)).toContain("resolve(cache,'receipts.json')")
        expect(compact(converter)).toContain('hash(bytes)!==receipt.hash')
        return
      }
      if (script.file === 'packages/seeds/package.json' && script.name === 'core:install') {
        expect(script.command).not.toContain('--env-file')
        const source = read('packages/seeds/src/install-core-library-cli.ts')
        expect(source).not.toMatch(/process\.env|loadEnvFile|import.*load-env|dotenv/)
        const urls = [...source.matchAll(/connectionString: '([^']+)'/g)].map(match => new URL(match[1]!))
        expect(urls).toHaveLength(2)
        for (const url of urls)
          expect({ host: url.hostname, port: url.port, database: url.pathname }).toEqual({
            host: '127.0.0.1',
            port: '54329',
            database: '/cms_demo',
          })
        expect(source).not.toMatch(/DROP DATABASE|CREATE DATABASE|bootstrap_hosted/i)
        return
      }
      if (script.file === 'package.json' && script.name === 'library:thumbnails') {
        expect(script.command).not.toContain('--env-file')
        const source = read('scripts/generate-core-thumbnails.mjs')
        expect(source).not.toMatch(/process\.env|loadEnvFile|load-env|dotenv|fetch\(/)
        expect(source).toContain('offline: true')
        expect(source).toContain('javaScriptEnabled: false')
        expect(source).toContain("await page.route('**/*', route => route.abort())")
        expect(source).toContain("page.locator('#s0').screenshot")
        return
      }
      if (script.file === 'package.json' && script.name === 'library:assets') {
        expect(script.command).not.toContain('--env-file')
        const source = read('scripts/generate-core-assets.mjs')
        expect(source).not.toMatch(/process\.env|loadEnvFile|import.*load-env|dotenv|\bfetch\(/)
        expect(source).toContain("['admin', 'site']")
        expect(source).toContain('bootstrap/dist/css/bootstrap-grid.min.css')
        return
      }
      if (script.command.includes('check-node.mjs') || script.command.includes('scripts/demo.mjs')) return
      expect(script.command).toMatch(/--env-file-if-exists=/)
    },
  )

  it('points at the repository root, whatever the workspace depth', () => {
    for (const script of directNodeScripts()) {
      const match = /--env-file-if-exists=(\S+)/.exec(script.command)
      if (!match) continue
      const from = dirname(join(REPO, script.file))
      const resolved = resolve(from, match[1]!)
      expect(relative(REPO, resolved), `${script.file} → ${script.name}`).toBe('.env')
    }
  })
})

describe('the loader itself', () => {
  it('never overrides a variable the environment already set', () => {
    // The property CI depends on. `process.loadEnvFile` has it; a dotenv
    // package configured the wrong way would not.
    expect(read('scripts/load-env.ts')).toContain('process.loadEnvFile')
    expect(read('scripts/load-env.ts')).toMatch(/existing|already set|wins/i)
  })

  it('tolerates a missing .env, because CI has none', () => {
    expect(read('scripts/load-env.ts')).toContain('existsSync')
  })

  it('is ESM, so a config that imports it is not loaded as CommonJS', () => {
    expect(JSON.parse(read('scripts/package.json'))).toMatchObject({ type: 'module' })
  })
})

describe('the Node major is pinned everywhere it is chosen', () => {
  it('has a runtime selector both nvm and fnm read', () => {
    expect(read('.nvmrc').trim()).toBe('24')
    expect(read('.node-version').trim()).toBe('24')
  })

  it('agrees with the engines declaration', () => {
    const root = JSON.parse(read('package.json')) as { engines?: { node?: string } }
    expect(root.engines?.node).toMatch(/24/)
  })

  it('agrees with CI and the reference image', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/node-version:\s*24/)
    expect(read('Dockerfile')).toMatch(/FROM node:24-/)
  })

  it('verify refuses to run on the wrong major rather than failing obscurely', () => {
    const root = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(root.scripts['verify']).toMatch(/check:node/)
  })
})
