import { createHash } from 'node:crypto'

export const REVALIDATE_PUBLIC = 'public, max-age=0, must-revalidate'

/** Data revisions alone miss renderer/deployment changes and dynamic headers. */
export function representationTag(identity: string, html: string, metadata = ''): string {
  return `"${createHash('sha256').update(identity).update('\0').update(html).update('\0').update(metadata).digest('hex')}"`
}

export function matchesEntityTag(header: string | null, tag: string): boolean {
  return (
    header !== null && header.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === tag)
  )
}
