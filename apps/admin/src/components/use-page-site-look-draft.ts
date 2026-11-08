import { useEffect, useRef, useState } from 'react'
import {
  FooterConfig,
  HeaderConfig,
  NavTree,
  type HeaderConfig as Header,
  type FooterConfig as Footer,
  type NavTree as Tree,
} from '@cms/schema'
import { editMenuItem, reorderMenuItem } from '../lib/menu-editing.ts'
import { loadPageSiteLook, savePageSiteLook } from '../app/pages/[pageId]/site-look-actions.ts'
import { useNavigationGuard } from './navigation-guard.ts'

type Loaded = Extract<Awaited<ReturnType<typeof loadPageSiteLook>>, { ok: true }>
type ChangedParts = { header: boolean; footer: boolean; menu: boolean }
type DraftOptions = {
  pageId: string
  editing: boolean
  menuEdit: { path: string; label: string; sequence: number } | null
  menuMove: { from: string; to: string; sequence: number } | null
  onDone: () => void
  onSaved: () => void
  registerDone: (finish: () => void) => void
  onDraftChange?: (
    draft: { header: Header; footer: Footer; menu: Tree },
    dirty: boolean,
    pending: boolean,
    valid: boolean,
    changed?: ChangedParts,
  ) => void
}
export type SiteLookDraftChange = DraftOptions['onDraftChange']

export function usePageSiteLookDraft({
  pageId,
  editing,
  menuEdit,
  menuMove,
  onDone,
  onSaved,
  registerDone,
  onDraftChange,
}: DraftOptions) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [header, setHeader] = useState<Header | null>(null)
  const [footer, setFooter] = useState<Footer | null>(null)
  const [menu, setMenu] = useState<Tree>([])
  const [saved, setSaved] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  useEffect(() => {
    let alive = true
    void loadPageSiteLook(pageId)
      .then(result => {
        if (!alive) return
        if (!result.ok) {
          setError(result.message)
          return
        }
        setLoaded(result)
        setHeader(result.frame.header.draft)
        setFooter(result.frame.footer.draft)
        setMenu(result.menu.draft)
        setSaved(JSON.stringify([result.frame.header.draft, result.frame.footer.draft, result.menu.draft]))
      })
      .catch(() => {
        if (alive) setError('The site look could not be loaded. Close this panel and try again.')
      })
    return () => {
      alive = false
    }
  }, [pageId])
  useEffect(() => {
    if (menuEdit && editing)
      setMenu(current =>
        editMenuItem(current, menuEdit.path, node => ({ ...node, label: menuEdit.label.slice(0, 80) })),
      )
  }, [menuEdit, editing])
  useEffect(() => {
    if (menuMove && editing) setMenu(current => reorderMenuItem(current, menuMove.from, menuMove.to))
  }, [menuMove, editing])
  const serial = JSON.stringify([header, footer, menu])
  const dirty = serial !== saved
  useNavigationGuard(() => ({ dirty: editing && dirty, pending }))
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (editing && (dirty || pending)) event.preventDefault()
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [editing, dirty, pending])
  const valid =
    HeaderConfig.safeParse(header).success && FooterConfig.safeParse(footer).success && NavTree.safeParse(menu).success
  useEffect(() => {
    if (header && footer && loaded)
      onDraftChange?.({ header, footer, menu }, dirty, pending, valid, {
        header: JSON.stringify(header) !== JSON.stringify(loaded.frame.header.published),
        footer: JSON.stringify(footer) !== JSON.stringify(loaded.frame.footer.published),
        menu: JSON.stringify(menu) !== JSON.stringify(loaded.menu.published),
      })
  }, [serial, dirty, pending, valid, onDraftChange, Boolean(loaded)])
  const validationMessage =
    header?.schemaVersion === 1 && header.partner && !header.partner.name.trim()
      ? 'Add the partner’s name before saving.'
      : footer?.schemaVersion === 1 &&
          footer.contact &&
          ![footer.contact.address, footer.contact.email, footer.contact.phone].some(value => value?.trim())
        ? 'Add an address, phone number or email for the contact details.'
        : 'Check the names and web addresses before saving. Each link needs a name and a destination.'
  async function save(): Promise<boolean> {
    if (!loaded || !loaded.canManage || !header || !footer || !valid || busy.current) return false
    if (!dirty) return true
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await savePageSiteLook({
        pageId,
        headerRevision: loaded.frame.header.revision,
        footerRevision: loaded.frame.footer.revision,
        menuRevision: loaded.menu.revision,
        header,
        footer,
        menu,
        frameChanged:
          JSON.stringify([header, footer]) !== JSON.stringify([loaded.frame.header.draft, loaded.frame.footer.draft]),
        menuChanged: JSON.stringify(menu) !== JSON.stringify(loaded.menu.draft),
      })
      if (!result.ok) {
        setError(result.message)
        return false
      }
      setLoaded(current =>
        current
          ? {
              ...current,
              frame: {
                ...current.frame,
                header: { ...current.frame.header, revision: result.headerRevision, draft: header },
                footer: { ...current.frame.footer, revision: result.footerRevision, draft: footer },
              },
              menu: { ...current.menu, revision: result.menuRevision, draft: menu },
            }
          : current,
      )
      setSaved(serial)
      onSaved()
      return true
    } catch {
      setError('The save could not be confirmed. Reload before trying again.')
      return false
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  useEffect(() =>
    registerDone(() => {
      if (!dirty) onDone()
      else
        void save().then(ok => {
          if (ok) onDone()
        })
    }),
  )
  return {
    loaded,
    header,
    setHeader,
    footer,
    setFooter,
    menu,
    setMenu,
    error,
    pending,
    serial,
    dirty,
    valid,
    validationMessage,
    save,
  }
}
