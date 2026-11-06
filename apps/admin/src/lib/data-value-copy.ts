import { siteDataValues, type DataValue } from '@cms/schema'
export function dataValueChangeWords(
  before: unknown,
  after: unknown,
  usage: Record<string, { id: string; title: string }[]>,
) {
  const old = siteDataValues(before),
    next = siteDataValues(after),
    ids = [...new Set([...old, ...next].map(row => row.id))],
    cells: { label: string; before: string; after: string }[] = [],
    words: string[] = []
  const shown = (row: DataValue) => row.value + (row.unit ? ' ' + row.unit : '')
  for (const id of ids) {
    const a = old.find(row => row.id === id),
      b = next.find(row => row.id === id)
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    const name = b?.label ?? a?.label ?? 'Number',
      pages = usage[id] ?? [],
      count = pages.length + ' ' + (pages.length === 1 ? 'page' : 'pages'),
      valueChanged = !a || !b || shown(a) !== shown(b)
    words.push(
      valueChanged
        ? a && b
          ? `${name} changed from ${shown(a)} to ${shown(b)} · ${count}`
          : b
            ? `${name}: added ${shown(b)} · ${count}`
            : `${name}: removed ${a ? shown(a) : 'number'} · ${count}`
        : `${name}: source, wording or checking status changed · ${count}`,
    )
    cells.push({
      label: name + ' · ' + count,
      before: a ? shown(a) + ' · ' + a.source + ' · ' + a.asOf : 'Not added',
      after: b
        ? shown(b) +
          ' · ' +
          b.source +
          ' · ' +
          b.asOf +
          ' · ' +
          (b.status === 'matches-report'
            ? 'Matches report'
            : b.status === 'needs-checking'
              ? 'Needs checking'
              : "Doesn't change")
        : 'Removed',
    })
    if (pages.length)
      cells.push({
        label: name + ' is shown on',
        before: pages.map(page => page.title).join(', '),
        after: pages.map(page => page.title).join(', '),
      })
  }
  return { words, cells }
}
