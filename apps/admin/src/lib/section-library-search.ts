export function symphonySectionNames(slug: string): string[] {
  return (
    (
      {
        'core-feature-slider': ['Theater Space'],
        'core-image-link-cards': ['Cards'],
        'core-faq': ['Accordion'],
        'core-text-block': ['Free Text Area'],
        'core-photo-grid': ['Ministries'],
        'core-stories': ['Stories'],
      } as Record<string, string[]>
    )[slug] ?? []
  )
}
export function matchesSectionSearch(entry: { name: string; slug: string; category?: string | null }, search: string) {
  const term = search.trim().toLowerCase()
  return (
    !term ||
    [
      entry.name,
      entry.slug,
      entry.slug.replace(/[-_]/g, ' '),
      entry.category ?? '',
      ...symphonySectionNames(entry.slug),
    ].some(value => value.toLowerCase().includes(term))
  )
}
export function sectionLibraryName(entry: { slug: string; name: string }) {
  return (
    (
      {
        'core-feature-slider': 'Hero slider',
        'core-image-link-cards': 'Cards',
        'core-faq': 'Questions and answers',
        'core-photo-grid': 'Service tiles',
        'core-stories': 'Stories by tag',
      } as Record<string, string>
    )[entry.slug] ?? entry.name
  )
}
