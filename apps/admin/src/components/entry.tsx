import type { ReactNode } from 'react'
import { BrandMark } from './brand-mark.tsx'
import styles from './entry.module.css'

export function EntryPanel({
  heading,
  lede,
  children,
  beforeHeading,
}: {
  heading: string
  lede: string
  children: ReactNode
  beforeHeading?: ReactNode
}): ReactNode {
  return (
    <main id="main" className={styles.entry}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <BrandMark className={styles.mark} />
          <strong>NCRD CMS</strong>
        </div>
        {beforeHeading}
        <h1>{heading}</h1>
        <p>{lede}</p>
        <div className={styles.form}>{children}</div>
      </section>
    </main>
  )
}
