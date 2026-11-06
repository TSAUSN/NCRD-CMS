const featured = [
  'Page openers',
  'Text & stories',
  'Cards & highlights',
  'People',
  'Events',
  'Calls to action',
  'Media',
  'From your lists & feeds',
  'Page helpers',
  'Hero',
  'Heroes',
  'Content',
  'Cards',
  'Stats',
  'Statistics',
]
export function compareSectionCategories(a: string, b: string): number {
  const priority = (name: string) => {
    const index = featured.indexOf(name)
    return index < 0 ? featured.length : index
  }
  return priority(a) - priority(b) || a.localeCompare(b)
}
