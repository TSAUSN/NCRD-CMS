import { EditorViewTools } from './editor-view-tools.tsx'
import { LargeScreenEditing } from '../../../components/content-editor.tsx'
import foundationStyles from './editor-foundation.module.css'
import type { PageEditorSession } from './use-page-editor-session.ts'
import type { PageEditorCommands } from './use-page-editor-commands.ts'

export type PageEditorScreenProps = {
  session: PageEditorSession
  commands: PageEditorCommands
}
import { PageEditorControls } from './page-editor-controls.tsx'
import { PageEditorPanes } from './page-editor-panes.tsx'
import { PageEditorOverlays } from './page-editor-overlays.tsx'
export function PageEditorScreen({ session, commands }: PageEditorScreenProps) {
  const { props, state } = session.draft
  const { setPane } = session.selection
  const { viewport, setViewport, setZoom, focusCanvas } = session.viewportState
  const { changeHistory } = session.persistence
  const { siteWide } = session.siteFrame
  const viewTools = (
    <EditorViewTools
      state={state}
      editingFrame={siteWide?.editing}
      viewport={viewport}
      changeHistory={changeHistory}
      setViewport={setViewport}
      setZoom={setZoom}
      setPane={setPane}
    />
  )
  return (
    <div
      className={'editor' + (!props.originalDesign ? ' ' + foundationStyles.nativeEditor : '')}
      data-focus-canvas={focusCanvas ? 'true' : undefined}
    >
      <PageEditorControls session={session} commands={commands} viewTools={viewTools} />
      <LargeScreenEditing notice>
        <PageEditorPanes session={session} commands={commands} viewTools={viewTools} />
        <PageEditorOverlays session={session} commands={commands} />
      </LargeScreenEditing>
    </div>
  )
}
