import type { ReactNode } from 'react'
import { Disclosure } from './disclosure.tsx'
/** Installation-only tools stay separate from everyday task controls. */
export function TestTools({ isSuperAdmin, children }: { isSuperAdmin: boolean; children: ReactNode }) {
  return isSuperAdmin ? <Disclosure title="Test tools (this computer only)">{children}</Disclosure> : null
}
