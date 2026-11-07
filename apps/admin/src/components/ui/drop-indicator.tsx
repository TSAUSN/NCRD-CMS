import type { ReorderMarker } from './use-reorderable-list.ts'
import styles from './reorderable-list.module.css'

export function DropIndicator({ marker, row }: { marker: ReorderMarker | null; row: string }) {
  if (marker?.row !== row) return null
  return (
    <span
      aria-hidden="true"
      className={styles.marker}
      data-drop-marker={marker.edge}
      data-indented={marker.indented || undefined}
    />
  )
}

/** Report a move independently of the screen's existing save notice. */
export function ReorderAnnouncement({ children }: { children: string }) {
  return (
    <span className={styles.announcement} aria-live="polite" aria-atomic="true" data-reorder-announcement>
      {children}
    </span>
  )
}
