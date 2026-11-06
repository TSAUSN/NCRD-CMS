export type SearchResult = {
  id: string
  label: string
  detail: string
  href: string
  group: 'Pages' | 'List items' | 'Actions'
}
export const COMMAND_SEARCH_EVENT = 'cms:open-command-search'
export function isCommandSearchKey(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing?: boolean
}): boolean {
  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.isComposing
}
export function searchLabel(value: unknown, fallback = 'Untitled item'): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || fallback
    : fallback
}
