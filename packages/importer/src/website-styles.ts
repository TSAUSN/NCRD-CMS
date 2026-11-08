import { type SiteFiles, type Asset, IMAGE_EXT, localWebsiteFile } from './website-files.ts'
import postcss from 'postcss'
import { relative, basename, extname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import type { PageSource } from './website-page-source.ts'
import { attr, textOf, walk } from './website-tree.ts'

export const ROOT_CLASS = 'cms-site-root'

/** The site's stylesheet, made fit for section CSS: document roots become the
 * section wrapper, local images and registered fonts become CMS addresses, and
 * what section CSS cannot load is left out and reported. */
export function siteStylesheet(css: string, file: string, files: SiteFiles, removed: Record<string, number>): string {
  let root: postcss.Root
  try {
    root = postcss.parse(css)
  } catch {
    const salvaged = salvageCss(css)
    if (!salvaged) {
      removed['unreadable stylesheet'] = (removed['unreadable stylesheet'] ?? 0) + 1
      files.unreadable.add(relative(files.root, file) || basename(file))
      return ''
    }
    removed['broken CSS rule'] = (removed['broken CSS rule'] ?? 0) + salvaged.dropped
    root = salvaged.root
  }
  root.walkAtRules('import', at => {
    const target = /url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"]/.exec(at.params)
    const path = target ? files.resolve(target[1] ?? target[2] ?? '', file) : null
    if (path && extname(path) === '.css')
      at.replaceWith(postcss.parse(siteStylesheet(readFileSync(path, 'utf8'), path, files, removed)).nodes)
    else {
      files.remote.add(at.params.slice(0, 120))
      at.remove()
    }
  })
  root.walkAtRules(at => {
    // Section CSS has no animations, print rules or document-level at-rules;
    // they are left out here once rather than refused section by section.
    if (/^(?:-[a-z]+-)?keyframes$/i.test(at.name)) {
      removed['animation (@keyframes)'] = (removed['animation (@keyframes)'] ?? 0) + 1
      at.remove()
      return
    }
    if (
      [
        'page',
        'charset',
        'namespace',
        'viewport',
        '-ms-viewport',
        'document',
        '-moz-document',
        'counter-style',
        'property',
      ].includes(at.name.toLowerCase())
    ) {
      removed[`@${at.name} rule`] = (removed[`@${at.name} rule`] ?? 0) + 1
      at.remove()
      return
    }
    if (at.name === 'layer') {
      if (at.nodes) at.replaceWith(...at.nodes.map(node => node.clone()))
      else at.remove()
    } else if (at.name === 'theme') {
      const rule = postcss.rule({ selector: `.${ROOT_CLASS}` })
      for (const node of at.nodes ?? []) if (node.type === 'decl') rule.append(node.clone())
      at.replaceWith(rule)
    } else if (
      at.name === 'supports' &&
      /-webkit-hyphens:\s*none/.test(at.params) &&
      /margin-trim/.test(at.params) &&
      at.nodes
    ) {
      at.replaceWith(...at.nodes.map(node => node.clone()))
    } else if (at.name === 'font-face') {
      const src = at.nodes?.find((node): node is postcss.Declaration => node.type === 'decl' && node.prop === 'src')
      const family = (
        at.nodes?.find((node): node is postcss.Declaration => node.type === 'decl' && node.prop === 'font-family')
          ?.value ?? ''
      ).replace(/['"]/g, '')
      let kept: Asset | null = null
      for (const match of src?.value.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g) ?? []) {
        const path = files.resolve(match[1]!, file)
        if (path) {
          kept = files.font(path)
          if (kept) break
        }
      }
      if (kept && src)
        src.value = src.value.replace(
          /url\([^)]*\)(\s*format\([^)]*\))?(\s*,\s*url\([^)]*\)(\s*format\([^)]*\))?)*/,
          `url("${kept.url}")`,
        )
      else {
        files.droppedFonts.add(family || 'unnamed')
        at.remove()
      }
    }
  })
  root.walkDecls(decl => {
    if (!/url\(/i.test(decl.value)) return
    let dropped = false
    decl.value = decl.value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote: string, address: string) => {
      if (/^data:/i.test(address) || address.startsWith('#')) return whole
      if (address.startsWith('/media/') || address.startsWith('/assets/')) return whole
      const path = files.resolve(address, file)
      if (path && IMAGE_EXT.has(extname(path).toLowerCase())) return `url("${files.image(path).url}")`
      files.remote.add(address.slice(0, 160))
      dropped = true
      return whole
    })
    if (dropped) {
      decl.remove()
      removed['remote CSS image'] = (removed['remote CSS image'] ?? 0) + 1
    }
  })
  root.walkRules(rule => {
    // The page's document roots are each section's wrapper.
    rule.selector = rule.selector
      .replace(/(^|[\s>+~,(])(?:html|body|:root|:host)(?=$|[\s>+~,.#:[)])/g, `$1.${ROOT_CLASS}`)
      .replace(new RegExp(`\\.${ROOT_CLASS}\\s+\\.${ROOT_CLASS}`, 'g'), `.${ROOT_CLASS}`)
  })
  return root.toString()
}

/** Real stylesheets break (a stray brace, HTML pasted into a <style>). Keep
 * every top-level rule or block that reads on its own and drop the rest,
 * rather than losing the whole sheet. */
function salvageCss(css: string): { root: postcss.Root; dropped: number } | null {
  const root = postcss.root()
  const text = css.replace(/<!--|-->/g, '')
  let depth = 0
  let start = 0
  let dropped = 0
  let kept = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth <= 0) {
        const chunk = text.slice(start, index + 1)
        try {
          root.append(postcss.parse(chunk).nodes)
          kept += 1
        } catch {
          dropped += 1
        }
        depth = 0
        start = index + 1
      }
    }
  }
  return kept ? { root, dropped } : null
}

/** Read each page's linked and inline sheets in document order. */
export function createPageStylesheetReader(
  root: string,
  publicDir: string,
  files: SiteFiles,
  removed: Record<string, number>,
  extraStyles: string[],
) {
  const sheets = new Map<string, string>()
  const remoteSheets = new Set<string>()
  return function pageStylesheet(page: PageSource): string {
    const parts: string[] = []
    for (const el of walk(page.document)) {
      if (el.tagName === 'link' && /\bstylesheet\b/i.test(attr(el, 'rel') ?? '')) {
        const href = attr(el, 'href') ?? ''
        const path = files.resolve(href, page.file)
        if (path) {
          if (!sheets.has(path)) sheets.set(path, siteStylesheet(readFileSync(path, 'utf8'), path, files, removed))
          parts.push(sheets.get(path)!)
        } else if (!remoteSheets.has(href)) {
          remoteSheets.add(href)
          files.remote.add(href.slice(0, 160))
          removed['remote stylesheet'] = (removed['remote stylesheet'] ?? 0) + 1
        }
      } else if (el.tagName === 'style') {
        parts.push(siteStylesheet(textOf(el), page.file, files, removed))
      }
    }
    for (const extra of extraStyles) {
      const path = localWebsiteFile(resolve(root, extra), [root, publicDir], new Set(['.css']))
      if (!path) throw new Error('Choose stylesheets inside the website or public assets folder.')
      if (!sheets.has(path)) sheets.set(path, siteStylesheet(readFileSync(path, 'utf8'), path, files, removed))
      parts.push(sheets.get(path)!)
    }
    return parts.join('\n')
  }
}
