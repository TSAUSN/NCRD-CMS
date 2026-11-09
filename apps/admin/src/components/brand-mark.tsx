import type { ReactNode } from 'react'

/** The Salvation Army shield used as the CMS mark; decorative beside the product name. */
export function BrandMark({ className }: { className?: string }): ReactNode {
  return <img className={className} src="/brand/salvation-army-shield.svg" alt="" aria-hidden="true" />
}
