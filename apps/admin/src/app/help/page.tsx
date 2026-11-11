import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell.tsx'
import { navigationFor } from '../../components/nav.ts'
import { PageHeader } from '../../components/ui/index.ts'
import { roleLabel } from '../../lib/queries.ts'
import { currentSession } from '../../lib/session.ts'
import { HelpTopics } from './topics.tsx'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Help' }

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const session = await currentSession()
  if (!session) redirect('/sign-in')
  const role = await roleLabel(session.principal.userId)
  const { topic } = await searchParams
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(undefined, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="Help"
          crumbs={[{ label: 'Home', href: '/' }, { label: 'Help' }]}
          lede="Find the steps for your work. Your account permissions still determine which controls you can use."
        />
        <HelpTopics role={role} initialTopic={topic} />
      </main>
    </AppShell>
  )
}
