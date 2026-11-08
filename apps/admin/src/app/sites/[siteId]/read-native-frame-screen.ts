import 'server-only'
import {
  getSite,
  getGlobalElementsWorkspace,
  getNavigationWorkspace,
  getManagedDraftTheme,
  roleLabel,
} from '../../../lib/queries.ts'
import { frameComponentDefinition, frameLogoField, frameValueRecord } from '../../../lib/frame-field-values.ts'
import { readFrameLogoChoices } from './frame-logo-choices.ts'
import type { GlobalElementsWorkspace } from '../../../server/queries/site-frame.ts'

function savedLogoIds(frame: GlobalElementsWorkspace, part: 'header' | 'footer'): unknown[] {
  if (part === 'header') {
    const header = frame.header.draft
    return header.schemaVersion === 1
      ? [header.brand.logoMediaId, header.brand.compactLogoMediaId]
      : [frameValueRecord(header.component.values.logo).media_id]
  }
  const footer = frame.footer.draft
  const config = footer.schemaVersion === 2 ? footer.component : null
  const { pin } = frameComponentDefinition(frame.components, config)
  const field = frameLogoField(pin?.slots ?? [])
  return [frameValueRecord(field ? config?.values[field.id] : null).media_id]
}

async function frameWithLogos(userId: string, siteId: string, part: 'header' | 'footer') {
  const frame = await getGlobalElementsWorkspace(userId, siteId)
  if (!frame) return null
  const logos = await readFrameLogoChoices(userId, siteId, savedLogoIds(frame, part))
  return { frame, logos }
}

export async function readNativeFrameScreen(userId: string, siteId: string, part: 'header' | 'footer') {
  const site = await getSite(userId, siteId)
  if (!site || site.original_design) return null
  const [frame, menu, theme, role] = await Promise.all([
    frameWithLogos(userId, siteId, part),
    getNavigationWorkspace(userId, siteId),
    getManagedDraftTheme(userId, siteId),
    roleLabel(userId),
  ])
  return frame && menu && theme ? { site, menu, theme, role, ...frame } : null
}
