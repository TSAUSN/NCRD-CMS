'use client'

import mediaUi from '../../../../components/media-ui.module.css'
import { useMediaWorkspace, type MediaWorkspaceProps } from './use-media-workspace.ts'
import { MediaWorkspaceScreen } from './media-workspace-screen.tsx'
import { MediaWorkspaceDetails } from './media-workspace-details.tsx'

export function MediaWorkspace(props: MediaWorkspaceProps) {
  const model = useMediaWorkspace(props)
  const { native, selected, replacement } = model
  return native ? (
    <div className={mediaUi.layout} data-details={Boolean(selected && !replacement)}>
      <MediaWorkspaceScreen model={model} />
      <MediaWorkspaceDetails model={model} />
    </div>
  ) : (
    <MediaWorkspaceScreen model={model} />
  )
}
