import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { librarySlug } from './catalogue-library.ts'
import { planPageTemplates, readV1PageTemplates } from './page-templates.ts'
import { decideV1Source, probeV1Root } from './parity.ts'

describe('V1’s page templates', () => {
  it('reads the template list as data, through comments, quotes and trailing commas, without running it', () => {
    const text = `import { x } from './registry.js'
// A comment with ] and { inside, and an apostrophe: it's fine.
export const pageTemplates = [
  {
    id: 'starter-v1', name: 'Starter Page', // trailing comment
    description: 'Hero, "stats" and a closing [CTA]; it\\'s quick.',
    /* block comment ] */
    sections: [{ templateId: 'hero-v1' }, { templateId: 'stats-v1', mode: 'linked' },],
  },
  { id: 'event-v1', name: 'Event', description: '', sites: ['echelonsymposium'], sections: [{ templateId: 'hero-event-v1' }] },
]
export function unrelated() { return [1, 2] }`
    expect(readV1PageTemplates(text)).toEqual([
      {
        id: 'starter-v1',
        name: 'Starter Page',
        description: 'Hero, "stats" and a closing [CTA]; it\'s quick.',
        sites: null,
        sections: ['hero-v1', 'stats-v1'],
      },
      { id: 'event-v1', name: 'Event', description: '', sites: ['echelonsymposium'], sections: ['hero-event-v1'] },
    ])
  })

  it('offers a site the templates V1 offered it whose every section is in its library', () => {
    const templates = readV1PageTemplates(`export const pageTemplates = [
      { id: 'a', name: 'A', sections: [{ templateId: 'hero-v1' }] },
      { id: 'b', name: 'B', sections: [{ templateId: 'hero-v1' }, { templateId: 'contact-form-v1' }] },
      { id: 'c', name: 'C', sites: ['humanneedsindex'], sections: [{ templateId: 'hero-v1' }] },
    ]`)
    const plan = planPageTemplates(
      templates,
      'echelonsymposium',
      id => librarySlug('echelonsymposium', id),
      new Set(['v1-lib-echelon-hero-v1']),
    )
    expect(plan).toEqual([
      { template: templates[0], disposition: 'recipe', slugs: ['v1-lib-echelon-hero-v1'] },
      {
        template: templates[1],
        disposition: 'skipped',
        reason: "its contact-form-v1 section is not in this site's library",
      },
    ])
  })
})

const source = decideV1Source(process.env.V1_ROOT, probeV1Root)
const withSource = source.kind === 'run' ? describe : describe.skip
withSource('V1’s real page templates', () => {
  it('reads all thirteen, with the site-only ones marked', () => {
    if (source.kind !== 'run') return
    const templates = readV1PageTemplates(
      readFileSync(path.join(source.v1Root, 'tsa-cms-admin', 'src', 'sections', 'pageTemplates.js'), 'utf8'),
    )
    expect(templates.map(template => template.name)).toEqual([
      'Starter Page',
      'Program Landing Page',
      'Donation Campaign',
      'Volunteer Landing Page',
      'Emergency Appeal',
      'Story / Article Page',
      'Contact Page',
      'Conference Page',
      'Story Page',
      'Landing Page',
      'Info & FAQ Page',
      'Showcase Page',
      'HNI Home Draft',
    ])
    expect(templates.filter(template => template.sites).map(template => [template.name, template.sites])).toEqual([
      ['Conference Page', ['echelonsymposium']],
      ['HNI Home Draft', ['humanneedsindex']],
    ])
  })
})
