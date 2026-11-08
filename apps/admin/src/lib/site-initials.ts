/** Two letters for a site's compact badge, including sites with a one-word name. */
export function siteInitials(name: string): string {
  const label = name.trim()
  const words = label.split(/\s+/)
  const initials =
    words.length > 1
      ? words
          .slice(0, 2)
          .map(word => Array.from(word)[0] ?? '')
          .join('')
      : Array.from(label).slice(0, 2).join('')
  return initials.toUpperCase()
}
