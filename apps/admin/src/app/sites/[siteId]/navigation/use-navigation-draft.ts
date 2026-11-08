import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { NavNode, NavTree } from '@cms/schema'
import { dropMenuItem, moveMenuItem } from '../../../../lib/menu-editing.ts'
import { menuReorderIntent, type MenuMove } from '../../../../lib/menu-reorder-intent.ts'
import { useReorderableList } from '../../../../components/ui/use-reorderable-list.ts'
import { publishNavigation, saveNavigationDraft } from '../../../actions/site-look.ts'
import type { ActionResult } from '../../../../lib/action-result.ts'

type PageChoice = { id: string; title: string; path: string; published: boolean }
type InitialWorkspace = {
  revision: number
  mode: 'auto' | 'manual'
  draftVersionId: string
  publishedVersionId: string | null
  draft: NavTree
  published: NavTree
  pages: PageChoice[]
}

const cloneTree = (tree: NavTree): NavTree => structuredClone(tree)
const serial = (tree: NavTree): string => JSON.stringify(tree)

function pageIds(tree: NavTree): Set<string> {
  const ids = new Set<string>()
  for (const node of tree) {
    if (node.target.type === 'page') ids.add(node.target.page_id)
    for (const child of node.children ?? []) {
      if (child.target.type === 'page') ids.add(child.target.page_id)
    }
  }
  return ids
}

export type NavigationEditorProps = {
  siteId: string
  siteName: string
  initial: InitialWorkspace
  canManage: boolean
}

export function useNavigationDraft({ siteId, initial, canManage }: NavigationEditorProps) {
  const router = useRouter()
  const [tree, setTree] = useState<NavTree>(() => cloneTree(initial.draft))
  const [mode, setMode] = useState<'auto' | 'manual'>(initial.mode)
  const [revision, setRevision] = useState(initial.revision)
  const [saved, setSaved] = useState(serial(initial.draft))
  const [savedMode, setSavedMode] = useState(initial.mode)
  const [published, setPublished] = useState<NavTree>(() => cloneTree(initial.published))
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [pending, startTransition] = useTransition()
  const command = useRef(false)

  const usedPages = useMemo(() => pageIds(tree), [tree])
  const availablePages = useMemo(
    () => initial.pages.filter(page => page.published && !usedPages.has(page.id)),
    [initial.pages, usedPages],
  )
  const pagePaths = useMemo(() => new Map(initial.pages.map(page => [page.id, page.path])), [initial.pages])
  const describeTarget = (node: NavNode) =>
    node.target.type === 'url' ? node.target.url : (pagePaths.get(node.target.page_id) ?? 'Page no longer available')
  const draftSerial = serial(tree)
  const dirty = draftSerial !== saved || mode !== savedMode
  const hasLiveVersion = initial.publishedVersionId !== null
  const draftIsLive = hasLiveVersion && draftSerial === serial(published) && !dirty

  // Refresh saved state when the server returns a different revision.
  useEffect(() => {
    setRevision(initial.revision)
    setTree(cloneTree(initial.draft))
    setSaved(serial(initial.draft))
    setMode(initial.mode)
    setSavedMode(initial.mode)
    setPublished(cloneTree(initial.published))
  }, [initial.revision, initial.draftVersionId, initial.publishedVersionId])

  function replaceRoot(index: number, node: NavNode) {
    setTree(current => current.map((item, itemIndex) => (itemIndex === index ? node : item)))
  }

  function replaceChild(parentIndex: number, childIndex: number, child: NavNode) {
    setTree(current =>
      current.map((node, index) =>
        index === parentIndex
          ? {
              ...node,
              children: (node.children ?? []).map((item, itemIndex) => (itemIndex === childIndex ? child : item)),
            }
          : node,
      ),
    )
  }

  function removeRoot(index: number) {
    setTree(current => current.filter((_, itemIndex) => itemIndex !== index))
  }

  function removeChild(parentIndex: number, childIndex: number) {
    setTree(current =>
      current.map((node, index) => {
        if (index !== parentIndex) return node
        const children = (node.children ?? []).filter((_, itemIndex) => itemIndex !== childIndex)
        return children.length === 0 ? { ...node, children: undefined } : { ...node, children }
      }),
    )
  }

  const reorder = useReorderableList({
    mimeType: 'application/x-cms-navigation',
    decide: point => menuReorderIntent(tree, point),
    apply: ({ from, to, position }: MenuMove) => {
      const next = dropMenuItem(tree, from, to, position)
      if (next === tree) return
      setTree(next)
      const [parent, child] = to.split('.').map(Number)
      const target = child === undefined ? tree[parent!] : tree[parent!]?.children?.[child]
      return 'Moved ' + (position === 'inside' ? 'under ' : position + ' ') + (target?.label || 'the menu item') + '.'
    },
  })

  function moveByKeyboard(path: string, action: 'up' | 'down' | 'indent' | 'outdent') {
    const next = moveMenuItem(tree, path, action)
    if (next === tree) return
    setTree(next)
    const [parent, child] = path.split('.').map(Number)
    const moved = child === undefined ? tree[parent!] : tree[parent!]?.children?.[child]
    const placement =
      action === 'indent' ? 'under the previous item' : action === 'outdent' ? 'out of the dropdown' : action
    reorder.announce(`Moved ${moved?.label || 'menu item'} ${placement}.`)
  }

  function addPage(page: PageChoice) {
    setTree(current => [
      ...current,
      {
        label: page.title,
        target: { type: 'page', page_id: page.id },
        visible: true,
      },
    ])
  }

  function addLink() {
    const label = linkLabel.trim()
    const url = linkUrl.trim()
    if (!label || !url) return
    setTree(current => [...current, { label, target: { type: 'url', url }, visible: true }])
    setLinkLabel('')
    setLinkUrl('')
    setLinkOpen(false)
  }

  function act(kind: 'save' | 'publish') {
    if (command.current || !canManage) return
    command.current = true
    setNotice(null)
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('revision', String(revision))
    data.set('tree', JSON.stringify(tree))
    data.set('mode', mode)
    startTransition(async () => {
      try {
        const result = kind === 'save' ? await saveNavigationDraft(data) : await publishNavigation(data)
        setNotice(result)
        if (result.ok) {
          setRevision(result.revision)
          if (kind === 'save') {
            setSaved(serial(tree))
            setSavedMode(mode)
          } else {
            setPublished(cloneTree(tree))
            router.refresh()
          }
        }
      } catch {
        setNotice({
          ok: false,
          kind: 'error',
          message:
            'The result could not be confirmed. Your draft is still here. Check the saved menu before trying again.',
        })
      } finally {
        command.current = false
      }
    })
  }

  return {
    tree,
    mode,
    setMode,
    notice,
    linkOpen,
    setLinkOpen,
    linkLabel,
    setLinkLabel,
    linkUrl,
    setLinkUrl,
    pending,
    availablePages,
    hasDraftPages: initial.pages.some(page => !page.published),
    dirty,
    hasLiveVersion,
    draftIsLive,
    describeTarget,
    replaceRoot,
    replaceChild,
    removeRoot,
    removeChild,
    reorder,
    moveByKeyboard,
    addPage,
    addLink,
    act,
    canManage,
  }
}

export type NavigationDraft = ReturnType<typeof useNavigationDraft>
