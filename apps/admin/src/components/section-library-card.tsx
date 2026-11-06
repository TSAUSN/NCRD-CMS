import type { HTMLAttributes, ReactNode } from 'react'
import type { LibraryEntry } from '../lib/queries.ts'
import { IconAlert } from './icons.tsx'
import styles from './section-library-card.module.css'
/** One presentation for the insertion shelf and the Sections workspace. */
export function SectionLibraryCard({
  entry,
  thumbnail,
  favourite,
  usage,
  actions,
  density = 'comfortable',
  ...props
}: HTMLAttributes<HTMLElement> & {
  density?: 'comfortable' | 'compact'
  entry: LibraryEntry
  thumbnail: ReactNode
  favourite: ReactNode
  usage?: ReactNode
  actions: ReactNode
}) {
  return (
    <article {...props} data-density={density} className={`section-card ${styles.card} ${props.className ?? ''}`}>
      {thumbnail}
      <div className="section-card-body">
        <div className="section-card-name">
          <h3>{entry.name}</h3>
          {favourite}
        </div>
        {density !== 'compact' && (
          <>
            <p className={styles.purpose}>
              {String(entry.slots[0]?.constraints?.corePurpose ?? entry.category ?? 'A section for your page.')}
            </p>
            <div className="section-card-meta">
              <span>{entry.scope === 'global' ? 'Core' : 'This site'}</span>
              <span aria-hidden="true">·</span>
              <span>
                {entry.slots.length} {entry.slots.length === 1 ? 'field' : 'fields'}
              </span>
            </div>
          </>
        )}
        {usage}
        {entry.carries_trusted_code && (
          <span className="section-card-warn">
            <IconAlert size={13} />
            Contains custom code — needs approval before the page goes live
          </span>
        )}
        <div className="section-card-actions">{actions}</div>
      </div>
    </article>
  )
}
