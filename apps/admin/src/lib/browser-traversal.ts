export type HistoryTraversalEvent = {
  navigationType: string
  cancelable: boolean
  destination: { url: string; sameDocument: boolean }
  preventDefault(): void
}

/** The Navigation API can pause some same-document history traversals. Its
 * presence is not a promise that every browser Back/Forward can be canceled:
 * check the event's actual capability and retain the recovery fallback.
 * https://html.spec.whatwg.org/multipage/nav-history-apis.html#fire-a-traverse-navigate-event
 */
export function guardHistoryTraversal(
  event: HistoryTraversalEvent,
  currentUrl: string,
  confirm: () => boolean,
): 'irrelevant' | 'allowed' | 'canceled' | 'unavailable' {
  if (event.navigationType !== 'traverse') return 'irrelevant'
  let current: URL
  let destination: URL
  try {
    current = new URL(currentUrl)
    destination = new URL(event.destination.url)
  } catch {
    return 'unavailable'
  }
  if (destination.origin !== current.origin || !event.destination.sameDocument) return 'irrelevant'
  if (destination.pathname === current.pathname && destination.search === current.search) return 'irrelevant'
  if (!event.cancelable) return 'unavailable'
  if (confirm()) return 'allowed'
  event.preventDefault()
  return 'canceled'
}
