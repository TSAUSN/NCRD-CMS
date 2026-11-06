'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { Disclosure } from '../../../components/ui/index.ts'
import styles from './inspector.module.css'
/** Keep a blank optional introduction out of the card task; rail selection still opens it. */
export function OptionalIntroduction({
  value,
  focused,
  children,
}: {
  value: unknown
  focused: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(
    () =>
      focused ||
      Boolean(
        String(value ?? '')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;|&#160;|\s/g, ''),
      ),
  )
  useEffect(() => {
    if (focused) setOpen(true)
  }, [focused])
  return (
    <Disclosure
      title="Introduction (optional)"
      className={styles.optionalIntroduction}
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      {children}
    </Disclosure>
  )
}
