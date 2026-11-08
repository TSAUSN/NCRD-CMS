import { useEffect, useRef, useState } from 'react'
import { FooterConfig, type FooterConfig as Footer, type ThemeTokens } from '@cms/schema'
import type { GlobalElementsWorkspace, NavigationWorkspace } from '../../../../lib/queries.ts'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import { readFooterLinks } from '../../../../lib/footer-links.ts'
import { carryFrameValues, frameValueRecord as record } from '../../../../lib/frame-field-values.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { prepareNationalHeader } from '../header/actions.ts'
import { saveFooter } from './actions.ts'
import { useFrameWorkspacePreview } from '../frame-workspace-preview.tsx'
import { useFooterLinks } from './use-footer-links.ts'
export type FooterWorkspaceProps = {
  siteId: string
  siteName: string
  initial: GlobalElementsWorkspace
  navigation: NavigationWorkspace
  theme: ThemeTokens
  media: MediaAsset[]
  superAdmin: boolean
  origin: string | null
}

export function useFooterDraft({ siteId, initial, navigation, theme, origin }: FooterWorkspaceProps) {
  const [footer, setFooter] = useState<Footer>(() => structuredClone(initial.footer.draft))
  const [components, setComponents] = useState(initial.components)
  const [revisions, setRevisions] = useState({
    headerRevision: initial.header.revision,
    footerRevision: initial.footer.revision,
  })
  const [saved, setSaved] = useState(JSON.stringify(initial.footer.draft))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [picker, setPicker] = useState(false)
  const busy = useRef(false)
  const serial = JSON.stringify(footer)
  const dirty = serial !== saved
  const config = footer.schemaVersion === 2 ? footer.component : null
  const component = config ? components.find(item => item.id === config.section_def_id) : null
  const pin = component?.versions.find(version => version.version === config?.section_def_version)
  const latest = component?.versions.at(-1)
  const fields = pin?.slots ?? []
  const values = config?.values ?? {}
  const logoSlot = fields.find(slot => slot.kind === 'image' && slot.constraints?.siteLogo === true)
  const inherits = logoSlot?.constraints?.inheritHeaderLogo === true && !Object.hasOwn(values, logoSlot.id)
  const logo = record(logoSlot ? values[logoSlot.id] : null)
  const links = readFooterLinks(values.links)
  const logoProblem =
    logoSlot && !inherits && (!logo.src || !String(logo.alt ?? '').trim())
      ? 'Choose a logo and add its description.'
      : ''
  const valid = FooterConfig.safeParse(footer).success && !logoProblem
  const page = initial.pages.find(page => page.published) ?? initial.pages[0]

  const preview = useFrameWorkspacePreview({
    origin,
    siteId,
    page,
    valid,
    look: { tokens: theme, header: initial.header.draft, footer, menu: navigation.draft },
  })
  const linkControls = useFooterLinks({ footer, setFooter, links, value })
  const { editing, setEditing } = linkControls
  useNavigationGuard(() => ({
    dirty: dirty || Boolean(editing),
    pending: pending || busy.current,
    draft: {
      label: 'Footer',
      saveDraft: save,
      discard: () => {
        setFooter(JSON.parse(saved))
        setEditing(null)
        setError('')
      },
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending || editing) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending, editing])
  function value(id: string, next: unknown) {
    if (footer.schemaVersion === 2)
      setFooter({ ...footer, component: { ...footer.component, values: { ...values, [id]: next } } })
  }
  function useHeader() {
    if (footer.schemaVersion !== 2 || !logoSlot) return
    const next = { ...values }
    delete next[logoSlot.id]
    setFooter({ ...footer, component: { ...footer.component, values: next } })
  }
  function upgrade() {
    if (footer.schemaVersion !== 2 || !pin || !latest) return
    setFooter({
      ...footer,
      component: {
        ...footer.component,
        section_def_version: latest.version,
        values: carryFrameValues(values, latest.slots, pin.slots),
      },
    })
    setNotice('Updated footer controls are in this draft. Check the preview, then save.')
  }
  async function prepare() {
    if (busy.current || dirty) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = await prepareNationalHeader(siteId)
      if (!result.ok) setError('The footer update could not be prepared. Your saved choices are safe. Try again.')
      else {
        setComponents(result.components)
        setNotice('The updated footer is ready to preview. No site has changed.')
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
    if (editing)
      return {
        ok: false,
        message: 'Finish the footer link with Done, or Cancel it, before saving. Keep editing to return to it.',
      }
    if (!valid) return { ok: false, message: logoProblem || 'Check the footer fields before saving.' }
    if (!dirty) return { ok: true }
    busy.current = true
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await saveFooter({ siteId, ...revisions, footer })
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
  const changed = JSON.stringify(footer) !== JSON.stringify(initial.footer.published)

  return {
    footer,
    setFooter,
    pending,
    error,
    notice,
    picker,
    setPicker,
    dirty,
    component,
    pin,
    latest,
    fields,
    values,
    logoSlot,
    inherits,
    logo,
    links,
    logoProblem,
    valid,
    value,
    useHeader,
    upgrade,
    prepare,
    save,
    changed,
    preview,
    linkControls,
  }
}
export type FooterDraft = ReturnType<typeof useFooterDraft>
