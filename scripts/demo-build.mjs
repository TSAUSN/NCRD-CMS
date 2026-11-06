import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Check source inputs rather than merely the existence of an old build. */
export function demoNeedsBuild(root) {
  const builds = ['admin', 'site'].map(app => join(root, 'apps', app, '.next', 'BUILD_ID'))
  if (builds.some(path => !existsSync(path))) return true
  const builtAt = Math.min(...builds.map(path => statSync(path).mtimeMs))
  const newer = path => existsSync(path) && statSync(path).mtimeMs > builtAt
  function changed(directory) {
    if (!existsSync(directory)) return false
    return readdirSync(directory, { withFileTypes: true }).some(entry => {
      const path = join(directory, entry.name)
      return entry.isDirectory()
        ? changed(path)
        : entry.isFile() && !/\.(?:test|spec)\.[^.]+$/.test(entry.name) && newer(path)
    })
  }
  if (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].some(file => newer(join(root, file)))) return true
  for (const app of ['admin', 'site']) {
    if (changed(join(root, 'apps', app, 'src'))) return true
    if (['package.json', 'next.config.ts', 'tsconfig.json'].some(file => newer(join(root, 'apps', app, file))))
      return true
  }
  const packages = join(root, 'packages')
  return (
    existsSync(packages) &&
    readdirSync(packages, { withFileTypes: true }).some(
      entry =>
        entry.isDirectory() &&
        (changed(join(packages, entry.name, 'src')) || newer(join(packages, entry.name, 'package.json'))),
    )
  )
}
