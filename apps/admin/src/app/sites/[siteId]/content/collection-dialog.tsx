'use client'
import { Dialog as SharedDialog } from '../../../../components/ui/index.ts'
import { type ReactNode } from 'react'

export function Dialog({
  title,
  lede,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string
  lede?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <SharedDialog density="compact" title={title} onClose={onClose} footer={footer} size={wide ? 'wide' : 'standard'}>
      {lede && <p>{lede}</p>}
      {children}
    </SharedDialog>
  )
}
