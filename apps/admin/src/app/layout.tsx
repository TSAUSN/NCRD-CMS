import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import './globals.css'
import '../styles/tokens.css'
import { CommandSearch } from '../components/command-search.tsx'
import { currentSession } from '../lib/session.ts'
import { DraftLeavePrompt } from '../components/draft-leave-prompt.tsx'
import { NavigationHistory } from '../components/ui/navigation-history.tsx'
import { NavigationProgress } from '../components/shell/navigation-progress.tsx'

export const metadata = { title: 'CMS v2' }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await currentSession()
  const canvasOrigin = (await headers()).get('x-cms-canvas-origin') ?? ''
  return (
    <html lang="en" data-cms-canvas-origin={canvasOrigin}>
      <body>
        <NavigationHistory />
        {session && <NavigationProgress />}
        <DraftLeavePrompt />
        {session && <CommandSearch />}
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
