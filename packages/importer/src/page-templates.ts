// V1's built-in page templates (“Page Templates” in V1's docked library,
// reference 12) as each site's page recipes (SPEC §6.5, LIB-09). V1 listed a
// starter as a name, a sentence and its sections in page order; inserting it
// added those sections with their starting content. V2's recipes do the same
// once V1's library is the site's own (LIB-01), so each template becomes a
// recipe of the site's `v1-lib-<site>-<id>` definitions.
//
// The template list is read as the data literal it is, never run: comments are
// dropped and the object syntax is rewritten to JSON before parsing.

export type V1PageTemplate = {
  id: string
  name: string
  description: string
  sites: string[] | null
  sections: string[]
}

/** The `pageTemplates` array of V1's `src/sections/pageTemplates.js`. */
export function readV1PageTemplates(text: string): V1PageTemplate[] {
  const start = text.indexOf('[', text.indexOf('export const pageTemplates'))
  if (start < 0) return []
  // The array's own closing bracket, skipping brackets inside strings and comments.
  let depth = 0
  let end = -1
  let quote = ''
  let comment = ''
  for (let at = start; at < text.length && end < 0; at += 1) {
    const char = text[at]!
    const next = text[at + 1]
    if (comment === 'line') {
      if (char === '\n') comment = ''
      continue
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') {
        comment = ''
        at += 1
      }
      continue
    }
    if (quote) {
      if (char === '\\') at += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '/' && next === '/') {
      comment = 'line'
      continue
    }
    if (char === '/' && next === '*') {
      comment = 'block'
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '[') depth += 1
    else if (char === ']' && --depth === 0) end = at
  }
  if (end < 0) return []
  // Rewrite the literal to JSON: drop comments, quote keys, double-quote strings, drop trailing commas.
  let json = ''
  let quoteChar = ''
  const literal = text.slice(start, end + 1)
  for (let at = 0; at < literal.length; at += 1) {
    const char = literal[at]!
    const next = literal[at + 1]
    if (quoteChar) {
      if (char === '\\') {
        json += next === "'" ? "'" : `\\${next}`
        at += 1
        continue
      }
      if (char === quoteChar) {
        json += '"'
        quoteChar = ''
        continue
      }
      json += char === '"' ? '\\"' : char
      continue
    }
    if (char === '/' && next === '/') {
      while (at < literal.length && literal[at] !== '\n') at += 1
      json += '\n'
      continue
    }
    if (char === '/' && next === '*') {
      at = literal.indexOf('*/', at + 2) + 1
      continue
    }
    if (char === "'" || char === '"') {
      quoteChar = char
      json += '"'
      continue
    }
    json += char
  }
  json = json.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/,(\s*[}\]])/g, '$1')
  const parsed = JSON.parse(json) as unknown[]
  return parsed.flatMap(entry => {
    const raw = entry as Record<string, unknown>
    if (typeof raw['id'] !== 'string' || typeof raw['name'] !== 'string' || !Array.isArray(raw['sections'])) return []
    const sections = (raw['sections'] as unknown[])
      .map(section => (section as { templateId?: unknown })?.templateId)
      .filter((id): id is string => typeof id === 'string')
    return [
      {
        id: raw['id'],
        name: raw['name'],
        description: typeof raw['description'] === 'string' ? raw['description'] : '',
        sites: Array.isArray(raw['sites'])
          ? (raw['sites'] as unknown[]).filter((site): site is string => typeof site === 'string')
          : null,
        sections,
      },
    ]
  })
}

export type TemplatePlan =
  | { template: V1PageTemplate; disposition: 'recipe'; slugs: string[] }
  | { template: V1PageTemplate; disposition: 'skipped'; reason: string }

/**
 * Which templates a site gets as recipes: those V1 offered it whose every
 * section is one of the site's imported library definitions. A template with
 * a section the library could not bring (a form awaiting the maintainer’s
 * decision) is skipped rather than offered with a section missing.
 */
export function planPageTemplates(
  templates: readonly V1PageTemplate[],
  site: string,
  slugFor: (id: string) => string,
  available: ReadonlySet<string>,
): TemplatePlan[] {
  return templates
    .filter(template => !template.sites || template.sites.includes(site))
    .map(template => {
      const slugs = template.sections.map(slugFor)
      const missing = template.sections.filter((_, index) => !available.has(slugs[index]!))
      return missing.length
        ? {
            template,
            disposition: 'skipped' as const,
            reason: `its ${missing.join(', ')} ${missing.length === 1 ? 'section is' : 'sections are'} not in this site's library`,
          }
        : { template, disposition: 'recipe' as const, slugs }
    })
}
