import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './local.mjs'

const { PNG } = createRequire(join(root, 'e2e/package.json'))('playwright-core/lib/utilsBundle')

export async function screenEvidence(page) {
  return page.evaluate(async () => {
    const styles = [...document.querySelectorAll('*')]
      .filter(element => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && element.checkVisibility({ visibilityProperty: true })
      })
      .map(element => {
        const computed = getComputedStyle(element)
        // Chromium does not guarantee an enumeration order for custom properties.
        return [
          element.tagName,
          ...Array.from(computed)
            .sort()
            .map(name => [name, computed.getPropertyValue(name)]),
        ]
      })
    const stylesheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => ({
      href: link.getAttribute('href'),
      media: link.getAttribute('media'),
    }))
    const bytes = new TextEncoder().encode(JSON.stringify(styles))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const computedStyleHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    return { computedStyleHash, styledElements: styles.length, stylesheets }
  })
}

export function differentPixels(before, after) {
  const a = PNG.sync.read(before)
  const b = PNG.sync.read(after)
  if (a.width !== b.width || a.height !== b.height) return null
  if (a.data.equals(b.data)) return 0
  let count = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data.readUInt32BE(i) !== b.data.readUInt32BE(i)) count++
  }
  return count
}

export function compareScreens(referenceDirectory, reference, directory, captures) {
  const key = row => JSON.stringify([row.pattern, row.width])
  const after = new Map(captures.map(row => [key(row), row]))
  const differences = []
  const stylesheetOrderChanges = []
  for (const original of reference.captures) {
    const current = after.get(key(original))
    const route = { pattern: original.pattern, width: original.width }
    if (!current) {
      differences.push({ ...route, reason: 'Missing capture' })
      continue
    }
    after.delete(key(original))
    const pixels = differentPixels(
      readFileSync(join(referenceDirectory, original.file)),
      readFileSync(join(directory, current.file)),
    )
    const stylesChanged = !original.computedStyleHash || original.computedStyleHash !== current.computedStyleHash
    if (pixels !== 0 || stylesChanged) differences.push({ ...route, pixels, stylesChanged })
    if (JSON.stringify(original.stylesheets) !== JSON.stringify(current.stylesheets)) stylesheetOrderChanges.push(route)
  }
  for (const row of after.values())
    differences.push({ pattern: row.pattern, width: row.width, reason: 'Extra capture' })
  return { compared: reference.captures.length, differences, stylesheetOrderChanges }
}
