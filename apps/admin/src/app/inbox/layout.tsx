import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { currentSession } from '../../lib/session.ts'
import { roleLabel } from '../../lib/queries.ts'
import { AppShell } from '../../components/app-shell.tsx'
import { navigationFor } from '../../components/nav.ts'
export default async function ReviewsLayout({ children }: { children: ReactNode }) {
  const session = await currentSession()
  if (!session) notFound()
  return (
    <AppShell
      email={session.email}
      role={await roleLabel(session.principal.userId)}
      groups={navigationFor(undefined, session.principal)}
    >
      {children}
    </AppShell>
  )
}
