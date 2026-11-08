import type { ChapterRow } from './chapters.ts'
/** Keep an acknowledged save visible while the refreshed server list arrives. */
export function chapterRowsAfterSave(rows: ChapterRow[], saved: ChapterRow[]): ChapterRow[] {
  const current = new Map(rows.map(row => [row.id, row]))
  for (const row of saved) {
    const incoming = current.get(row.id)
    if (!incoming || BigInt(row.revision) > BigInt(incoming.revision)) current.set(row.id, row)
  }
  return [...current.values()].sort(
    (a, b) =>
      Number(isSampleChapter(a.config.name)) - Number(isSampleChapter(b.config.name)) ||
      a.config.name.localeCompare(b.config.name) ||
      a.id.localeCompare(b.id),
  )
}

function isSampleChapter(name: string): boolean {
  return /^\s*\[/.test(name) || /\(sample\)/i.test(name)
}
