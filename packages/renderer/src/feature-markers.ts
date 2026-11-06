import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'

// Inspect rendered elements without rewriting their markup. Text, comments,
// raw script/style content and inert template content cannot opt into a feature.
export type RenderedFeatures = Readonly<{
  materialIcons: boolean
  dataSource: boolean
  echelonStyles: boolean
  echelonTemplate: boolean
  reportText: boolean
  nationalNavigation: boolean
  chapterDirectory: boolean
  heroSlides: boolean
  storyWidgets: boolean
  faqFilter: boolean
  scheduleFilter: boolean
  providerFullscreen: boolean
  siteWidget: boolean
  adobeKit: boolean
  embedProviders: readonly string[]
}>

const cache = new Map<string, RenderedFeatures>()
const MAX_CACHED_CHARACTERS = 1_000_000
let cachedCharacters = 0

export function renderedFeatures(html: string): RenderedFeatures {
  const existing = cache.get(html)
  if (existing) return existing
  const features = {
    materialIcons: false,
    dataSource: false,
    echelonStyles: false,
    echelonTemplate: false,
    reportText: false,
    nationalNavigation: false,
    chapterDirectory: false,
    heroSlides: false,
    storyWidgets: false,
    faqFilter: false,
    scheduleFilter: false,
    providerFullscreen: false,
    siteWidget: false,
    adobeKit: false,
  }
  const providers = new Set<string>()
  const nodes: DefaultTreeAdapterTypes.Node[] = [...parseFragment(html).childNodes]
  while (nodes.length) {
    const node = nodes.pop()!
    if (!('tagName' in node)) continue
    const attributes = new Map(node.attrs.map(({ name, value }) => [name, value]))
    const classes = (attributes.get('class') ?? '').split(/[\t\n\f\r ]+/)
    features.materialIcons ||= classes.includes('cms-material-symbols')
    features.dataSource ||= classes.includes('cms-data-source')
    features.echelonStyles ||= classes.some(value => value.startsWith('echelon-'))
    features.echelonTemplate ||= classes.includes('echelon-template')
    features.reportText ||= classes.some(value => value === 'sawso-report' || value.startsWith('sawso-report-'))
    features.nationalNavigation ||= classes.includes('national-header-row')
    features.chapterDirectory ||= attributes.has('data-cms-echelon-directory')
    features.heroSlides ||= attributes.has('data-cms-hero')
    features.storyWidgets ||= attributes.has('data-cms-stories-widget')
    features.faqFilter ||= attributes.has('data-cms-faq-filter')
    features.scheduleFilter ||= attributes.has('data-cms-track-filter')
    features.providerFullscreen ||= attributes.has('data-cms-provider-fullscreen')
    features.siteWidget ||= attributes.has('data-cms-site-widget')
    features.adobeKit ||= node.tagName === 'link' && attributes.get('data-cms-adobe-kit') === 'euh2hvn'
    const provider = attributes.get('data-cms-embed-provider')
    if (provider) providers.add(provider)
    for (const child of node.childNodes) nodes.push(child)
  }
  const result = Object.freeze({ ...features, embedProviders: Object.freeze([...providers]) })
  // Retain only a few exact inputs, with a total size bound. The cache is pure
  // presentation analysis; it contains no authorization or publication state.
  if (html.length <= MAX_CACHED_CHARACTERS) {
    while (cache.size >= 4 || cachedCharacters + html.length > MAX_CACHED_CHARACTERS) {
      const oldest = cache.keys().next().value!
      cachedCharacters -= oldest.length
      cache.delete(oldest)
    }
    cache.set(html, result)
    cachedCharacters += html.length
  }
  return result
}
