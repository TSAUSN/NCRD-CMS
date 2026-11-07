/** Place a page on either side of its anchor in the site's full page order. */
export function movePageInOrder(
  order: readonly string[],
  pageId: string,
  position: { beforeId?: string; afterId?: string },
): string[] | null {
  const { beforeId, afterId } = position
  const anchor = beforeId ?? afterId
  if ((beforeId && afterId) || !anchor || anchor === pageId || !order.includes(anchor) || !order.includes(pageId))
    return null
  const next = order.filter(id => id !== pageId)
  next.splice(next.indexOf(anchor) + (afterId ? 1 : 0), 0, pageId)
  return next
}
