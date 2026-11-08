'use client'

import type { PageEditorProps } from './editor-types.ts'
import { usePageEditorSession } from './use-page-editor-session.ts'
import { usePageEditorCommands } from './use-page-editor-commands.ts'
import { PageEditorScreen } from './page-editor-screen.tsx'

export type { LibraryEntry } from '../../../lib/queries.ts'

export function PageEditor(props: PageEditorProps) {
  const session = usePageEditorSession(props)
  const commands = usePageEditorCommands(session)
  return <PageEditorScreen session={session} commands={commands} />
}
