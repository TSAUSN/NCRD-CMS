import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importBetterTogetherPage, type BetterTogetherPage } from './better-together.ts'
const [root, html, cache, out, page, title] = process.argv.slice(2)
if (!root || !html || !cache || !out)
  throw new Error(
    'Usage: pnpm --filter @cms/importer bt-homepage <local-site-folder> <rendered-index.html> <offline-cache-folder> <output.json> [marketing-page] [page-title]',
  )
const result = importBetterTogetherPage({
  root,
  html: readFileSync(resolve(html), 'utf8'),
  cache,
  ...(page ? { page: page as BetterTogetherPage } : {}),
  ...(title ? { title } : {}),
})
writeFileSync(resolve(out), JSON.stringify(result.archive))
writeFileSync(
  resolve(out) + '.report.json',
  JSON.stringify({ sections: result.report, needsOwner: result.omitted }, null, 2),
)
writeFileSync(
  resolve(out) + '.report.md',
  `# BT2027 editability report\n\n${result.report.map(row => `- ${row.name}: ${row.text} text fields, ${row.images} pictures and ${row.links} editable links.`).join('\n')}\n\nText and pictures can be changed in the CMS. Source links remain links; repeated speakers, sponsor logos and workshop rows still need the list conversion pass. Original styling and approved behavior are carried by the reviewed site files.\n\n## Needs owner\n\n${result.omitted.length ? result.omitted.map(item => '- ' + item).join('\n') : 'None recorded.'}\n`,
)
console.log(
  `BT2027 page archive: ${result.report.length} sections/frame pieces, ${result.archive.content.site_files!.length} reviewed files. See the adjacent report for offline gaps.`,
)
