// pnpm import:website <folder> --name "Site name" --slug site-address [options]
//
// Writes a content archive the CMS imports through Create a site → Import an
// existing site, and a Markdown report beside it. Reads the folder only.
//
//   --out <file>        archive path (default: <slug>.cms-site.json)
//   --kind <kind>       resource | event | general (default: general)
//   --pages a.html,b.html   pages to import (default: every .html in the folder)
//   --css <file>        a stylesheet a bundler injects at run time (repeatable)
//   --public <folder>   where root-relative addresses resolve (default: the folder)
//   --domain <host>     the site's own domain: full addresses on it are read from the folder (repeatable)
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importWebsite, websiteReportMarkdown } from './website.ts'

const args = process.argv.slice(2)
const flags = new Map<string, string[]>()
const positional: string[] = []
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]!
  if (arg.startsWith('--')) {
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
    flags.set(arg.slice(2), [...(flags.get(arg.slice(2)) ?? []), value])
    index += 1
  } else positional.push(arg)
}
const root = positional[0]
const name = flags.get('name')?.[0]
const slug = flags.get('slug')?.[0]
if (!root || !name || !slug) {
  console.error(
    'usage: pnpm import:website <folder> --name "Site name" --slug site-address [--out file] [--kind general] [--pages a.html,b.html] [--css file] [--public folder] [--domain host]',
  )
  process.exit(1)
}
const kind = (flags.get('kind')?.[0] ?? 'general') as 'resource' | 'event' | 'general'
const out = resolve(flags.get('out')?.[0] ?? `${slug}.cms-site.json`)
const result = await importWebsite({
  root,
  name,
  slug,
  kind,
  pages: flags
    .get('pages')?.[0]
    ?.split(',')
    .map(page => page.trim())
    .filter(Boolean),
  css: flags.get('css'),
  publicDir: flags.get('public')?.[0],
  domains: flags.get('domain'),
})
writeFileSync(out, JSON.stringify(result.archive))
writeFileSync(out.replace(/\.json$/, '') + '.report.md', websiteReportMarkdown(result.report))
const { report } = result
console.log(
  `${report.pages.length} pages, ${report.sections.length} sections, ${report.media.images} images, ${report.documents} documents`,
)
console.log(`archive: ${out}`)
console.log(`report:  ${out.replace(/\.json$/, '')}.report.md`)
const failed = report.sections.filter(
  section => section.problems.length && section.fields === 0 && section.mode === 'static',
)
if (failed.length) console.log(`${failed.length} sections need a look; see the report.`)
