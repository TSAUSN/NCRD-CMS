import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  sourceSampleValues,
  DEFAULT_FOOTER_CONFIG,
  DEFAULT_HEADER_CONFIG,
  type FooterConfig,
  type HeaderConfig,
} from '@cms/schema'
import type { FrameComponentChoice } from '../../../../lib/queries.ts'
import type { SitePreviewContext } from '../../../../lib/preview-context.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import {
  publishGlobalElements,
  revertGlobalElementsToLive,
  saveGlobalElementsDraft,
} from '../../../actions/site-look.ts'
import type { GlobalElementsActionResult } from '../../../../lib/action-result.ts'

type PageChoice = { kind?: string; id: string; title: string; path: string; published: boolean; versionId: string }
type ElementHead<T> = {
  id: string
  revision: number
  draftVersionId: string
  publishedVersionId: string | null
  draft: T
  published: T
}
type InitialWorkspace = {
  contentSummary?: string
  header: ElementHead<HeaderConfig>
  footer: ElementHead<FooterConfig>
  pages: PageChoice[]
  previewPages: { title: string; versionId: string }[]
  components: FrameComponentChoice[]
}
type MediaChoice = { id: string; name: string; url: string; alt: string }
const clone = <T>(value: T): T => structuredClone(value)
const serial = (header: HeaderConfig, footer: FooterConfig) => JSON.stringify({ header, footer })

export type GlobalElementsProps = {
  siteId: string
  siteName: string
  initial: InitialWorkspace
  canManage: boolean
  superAdmin: boolean
  media: MediaChoice[]
  /** The menu and design around the frame: saved drafts or what is live. As in
   * the page editor, a site with nothing live starts on its saved drafts. */
  initialSitePreview?: SitePreviewContext
}

export function useGlobalFrameDraft({ siteId, siteName, initial, canManage }: GlobalElementsProps) {
  const router = useRouter()
  const [header, setHeader] = useState<HeaderConfig>(() => clone(initial.header.draft))
  const [footer, setFooter] = useState<FooterConfig>(() => clone(initial.footer.draft))
  const actionInFlight = useRef(false)
  const sourceDrafts = useRef<{
    header: Partial<Record<1 | 2, HeaderConfig>>
    footer: Partial<Record<1 | 2, FooterConfig>>
  }>({ header: {}, footer: {} })
  const [publishedHeader, setPublishedHeader] = useState(() => clone(initial.header.published))
  const [publishedFooter, setPublishedFooter] = useState(() => clone(initial.footer.published))
  const [saved, setSaved] = useState(() => serial(initial.header.draft, initial.footer.draft))
  const [headerRevision, setHeaderRevision] = useState(initial.header.revision)
  const [footerRevision, setFooterRevision] = useState(initial.footer.revision)
  const [notice, setNotice] = useState<GlobalElementsActionResult | null>(null)
  const [confirming, setConfirming] = useState<'publish' | 'revert' | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    sourceDrafts.current = { header: {}, footer: {} }
    setHeader(clone(initial.header.draft))
    setFooter(clone(initial.footer.draft))
    setPublishedHeader(clone(initial.header.published))
    setPublishedFooter(clone(initial.footer.published))
    setSaved(serial(initial.header.draft, initial.footer.draft))
    setHeaderRevision(initial.header.revision)
    setFooterRevision(initial.footer.revision)
  }, [
    initial.header.revision,
    initial.footer.revision,
    initial.header.draftVersionId,
    initial.footer.draftVersionId,
    initial.header.publishedVersionId,
    initial.footer.publishedVersionId,
  ])

  const currentSerial = serial(header, footer)
  const dirty = currentSerial !== saved
  useNavigationGuard(() => ({ dirty, pending: pending || actionInFlight.current }))
  const hasLiveVersion = initial.header.publishedVersionId !== null && initial.footer.publishedVersionId !== null
  const draftIsLive = hasLiveVersion && currentSerial === serial(publishedHeader, publishedFooter) && !dirty

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty || pending || actionInFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  /** Keep each source's local work while comparing them; only the selected source is saved. */
  function chooseSource(kind: 'header' | 'footer', authored: boolean) {
    if (actionInFlight.current) return
    const targetVersion = authored ? 2 : 1
    const first = initial.components.find(component => component.placement === kind && component.status === 'active')
    const version = first?.versions.at(-1)
    if (kind === 'header') {
      if (header.schemaVersion === targetVersion) return
      sourceDrafts.current.header[header.schemaVersion] = clone(header)
      const previous = sourceDrafts.current.header[targetVersion]
      if (previous) setHeader(clone(previous))
      else if (authored && first && version)
        setHeader({
          schemaVersion: 2,
          enabled: header.enabled,
          sticky: header.sticky,
          component: {
            section_def_id: first.id,
            section_def_version: version.version,
            values: sourceSampleValues(version.slots),
          },
        })
      else if (!authored)
        setHeader({
          ...clone(DEFAULT_HEADER_CONFIG),
          enabled: header.enabled,
          sticky: header.sticky,
          brand: { ...DEFAULT_HEADER_CONFIG.brand, siteName },
        })
    } else {
      if (footer.schemaVersion === targetVersion) return
      sourceDrafts.current.footer[footer.schemaVersion] = clone(footer)
      const previous = sourceDrafts.current.footer[targetVersion]
      if (previous) setFooter(clone(previous))
      else if (authored && first && version)
        setFooter({
          schemaVersion: 2,
          enabled: footer.enabled,
          component: {
            section_def_id: first.id,
            section_def_version: version.version,
            values: sourceSampleValues(version.slots),
          },
        })
      else if (!authored)
        setFooter({
          ...clone(DEFAULT_FOOTER_CONFIG),
          enabled: footer.enabled,
          brand: { ...DEFAULT_FOOTER_CONFIG.brand, siteName },
        })
    }
  }

  function act(kind: 'save' | 'publish' | 'revert') {
    if (actionInFlight.current || !canManage) return
    actionInFlight.current = true
    setNotice(null)
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('headerRevision', String(headerRevision))
    data.set('footerRevision', String(footerRevision))
    data.set('header', JSON.stringify(header))
    data.set('footer', JSON.stringify(footer))
    startTransition(async () => {
      try {
        const result =
          kind === 'save'
            ? await saveGlobalElementsDraft(data)
            : kind === 'publish'
              ? await publishGlobalElements(data)
              : await revertGlobalElementsToLive(data)
        setNotice(result)
        setConfirming(null)
        if (result.ok) {
          setHeaderRevision(result.headerRevision)
          setFooterRevision(result.footerRevision)
          if (kind === 'save') setSaved(serial(header, footer))
          else if (kind === 'publish') {
            setPublishedHeader(clone(header))
            setPublishedFooter(clone(footer))
            router.refresh()
          } else {
            setHeader(clone(publishedHeader))
            setFooter(clone(publishedFooter))
            setSaved(serial(publishedHeader, publishedFooter))
            router.refresh()
          }
        }
      } catch {
        setNotice({
          ok: false,
          kind: 'error',
          message:
            'The result could not be confirmed. Your edits are still here, but the server may have completed the request. Reload and check the saved and live state before trying again.',
        })
        setConfirming(null)
      } finally {
        actionInFlight.current = false
      }
    })
  }

  return {
    header,
    editHeader(next: HeaderConfig) {
      if (!actionInFlight.current) setHeader(next)
    },
    footer,
    editFooter(next: FooterConfig) {
      if (!actionInFlight.current) setFooter(next)
    },
    pending,
    notice,
    confirming,
    setConfirming,
    chooseSource,
    act,
    currentSerial,
    dirty,
    hasLiveVersion,
    draftIsLive,
    cancelConfirmation: () => {
      if (!actionInFlight.current) setConfirming(null)
    },
  }
}
