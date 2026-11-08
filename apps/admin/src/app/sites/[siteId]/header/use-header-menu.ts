import { useEffect, useRef, useState } from 'react'
import {
  HeaderConfig,
  HeaderDraftConfig,
  NavTree,
  validTrackingCode,
  type HeaderConfig as Header,
  type ThemeTokens,
} from '@cms/schema'
import type { GlobalElementsWorkspace, NavigationWorkspace } from '../../../../lib/queries.ts'
import type { HeaderLogoChoice } from './logo-choices.ts'
import { carryFrameValues, frameValueRecord as record } from '../../../../lib/frame-field-values.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { validHeaderButtonUrl } from '../../../../lib/header-button-link.ts'
import { prepareNationalHeader, saveHeaderMenu } from './actions.ts'
import { useFrameWorkspacePreview } from '../frame-workspace-preview.tsx'
export type HeaderMenuProps = {
  siteId: string
  siteName: string
  initial: GlobalElementsWorkspace
  navigation: NavigationWorkspace
  theme: ThemeTokens
  media: HeaderLogoChoice[]
  superAdmin: boolean
  origin: string | null
}

export function useHeaderMenu({ siteId, initial, navigation, theme, media, origin }: HeaderMenuProps) {
  const [header, setHeader] = useState<Header>(() => structuredClone(initial.header.draft))
  const [tree, setTree] = useState<NavTree>(() => structuredClone(navigation.draft))
  const [mode, setMode] = useState(navigation.mode)
  const [tab, setTab] = useState('menu')
  const [components, setComponents] = useState(initial.components)
  const [revisions, setRevisions] = useState({
    headerRevision: initial.header.revision,
    footerRevision: initial.footer.revision,
    menuRevision: navigation.revision,
  })
  const [saved, setSaved] = useState(JSON.stringify([initial.header.draft, navigation.draft, navigation.mode]))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [itemEditing, setItemEditing] = useState(false)
  const [picker, setPicker] = useState(false)
  const [logoFailed, setLogoFailed] = useState<string | null>(null)
  const busy = useRef(false)
  const serial = JSON.stringify([header, tree, mode])
  const dirty = serial !== saved
  const config = header.schemaVersion === 2 ? header.component : null
  const component = config ? components.find(item => item.id === config.section_def_id) : null
  const pin = component?.versions.find(version => version.version === config?.section_def_version)
  const latest = component?.versions.at(-1)
  const fields = pin?.slots ?? []
  const values = config?.values ?? {}
  const logo = record(values.logo)
  const logoSlot = fields.find(slot => slot.constraints?.siteLogo === true)
  const buttons = fields.filter(slot => slot.kind === 'button')
  const otherFields = fields.filter(
    slot => !['logo', 'menu', 'name', 'tagline'].includes(slot.id) && slot.kind !== 'button',
  )
  const logoUrl = media.find(asset => asset.id === logo.media_id)?.previewUrl ?? String(logo.src ?? '')
  const shield = '/cms-themes/sawso/salvation-army-shield.svg'
  const logoProblem =
    header.schemaVersion === 1 && (header.brand.logoMediaId || header.brand.compactLogoMediaId)
      ? !header.brand.siteName.trim()
        ? 'Add the site name to describe this logo.'
        : !header.brand.logoDescription?.trim()
          ? 'Add a description for the logo.'
          : ''
      : logoSlot && (!logo.src || !String(logo.alt ?? '').trim())
        ? 'Choose a logo and add its description.'
        : ''
  const buttonProblem = buttons.find(slot => {
    const value = record(values[slot.id])
    if (slot.id === 'secondary' && !Object.hasOwn(values, slot.id)) return false
    return (
      !String(value.label ?? '').trim() ||
      !validHeaderButtonUrl(value.url) ||
      !validTrackingCode(String(value.trackingCode ?? ''))
    )
  })
  const legacyDescriptionAbsent = header.schemaVersion === 1 && !Object.hasOwn(header.brand, 'logoDescription')
  const valid =
    HeaderConfig.safeParse(header).success &&
    NavTree.safeParse(tree).success &&
    (!logoProblem || legacyDescriptionAbsent) &&
    !buttonProblem
  const saveValid = valid && !logoProblem && HeaderDraftConfig.safeParse(header).success
  const page = initial.pages.find(page => page.published) ?? initial.pages[0]

  const preview = useFrameWorkspacePreview({
    origin,
    siteId,
    page,
    valid,
    look: { tokens: theme, header, footer: initial.footer.draft, menu: tree },
  })
  useNavigationGuard(() => ({
    dirty,
    pending: pending || busy.current,
    draft: {
      label: 'Header & menu',
      saveDraft: save,
      discard: () => {
        const [savedHeader, savedTree, savedMode] = JSON.parse(saved)
        setHeader(savedHeader)
        setTree(savedTree)
        setMode(savedMode)
        setError('')
      },
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  function value(id: string, value: unknown) {
    if (header.schemaVersion !== 2) return
    setHeader({ ...header, component: { ...header.component, values: { ...values, [id]: value } } })
  }
  function upgrade() {
    if (header.schemaVersion !== 2 || !pin || !latest) return
    setHeader({
      ...header,
      component: {
        ...header.component,
        section_def_version: latest.version,
        values: carryFrameValues(values, latest.slots, pin.slots),
      },
    })
    setNotice('Updated header controls are in this draft. Check the preview, then save.')
  }
  async function prepare() {
    if (busy.current || dirty) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = await prepareNationalHeader(siteId)
      if (!result.ok) setError(result.message)
      else {
        setComponents(result.components)
        setNotice('The updated header is ready to preview. No site has changed.')
      }
    } catch {
      setError('The update could not be confirmed. Reload before trying again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  async function save() {
    if (busy.current) return { ok: false, message: 'Wait for the current save to finish.' }
    if (itemEditing)
      return {
        ok: false,
        message: 'Finish the menu item with Done, or Cancel it, before saving. Keep editing to return to it.',
      }
    if (!saveValid)
      return {
        ok: false,
        message:
          logoProblem ||
          (buttonProblem
            ? 'Check the button text, destination and tracking code before saving.'
            : 'Check the header and menu fields before saving.'),
      }
    if (!dirty) return { ok: true }
    busy.current = true
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await saveHeaderMenu({ siteId, ...revisions, header, menu: tree, mode })
      if (!result.ok) {
        setError(result.message)
        return { ok: false, message: result.message }
      } else {
        setRevisions(result)
        setSaved(serial)
        setNotice(result.message)
        return { ok: true }
      }
    } catch {
      const message = 'The save could not be confirmed. Your work is still here. Reload to compare before trying again.'
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const changes =
    (JSON.stringify(header) !== JSON.stringify(initial.header.published) ? 1 : 0) +
    (JSON.stringify(tree) !== JSON.stringify(navigation.published) ? 1 : 0)

  return {
    header,
    setHeader,
    tree,
    setTree,
    mode,
    setMode,
    tab,
    setTab,
    pending,
    error,
    notice,
    itemEditing,
    setItemEditing,
    picker,
    setPicker,
    logoFailed,
    setLogoFailed,
    dirty,
    component,
    pin,
    latest,
    fields,
    values,
    logo,
    logoSlot,
    buttons,
    otherFields,
    logoUrl,
    shield,
    logoProblem,
    buttonProblem,
    valid,
    saveValid,
    value,
    upgrade,
    prepare,
    save,
    changes,
    preview,
  }
}
export type HeaderMenuModel = ReturnType<typeof useHeaderMenu>
