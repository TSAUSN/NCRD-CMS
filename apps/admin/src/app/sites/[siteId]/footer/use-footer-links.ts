import { useReorderableList } from '../../../../components/ui/use-reorderable-list.ts'
import { flatReorderIntent } from '../../../../components/ui/flat-reorder.ts'
import { useState } from 'react'
import { NavUrl, type FooterConfig as Footer } from '@cms/schema'
import { writeFooterLinks, type FooterLink } from '../../../../lib/footer-links.ts'
type LinkStep = { index: number; snapshot: Footer; fresh: boolean }

type FooterLinksInputs = {
  footer: Footer
  setFooter: (value: Footer) => void
  links: FooterLink[] | null
  value: (id: string, next: unknown) => void
}
export function useFooterLinks({ footer, setFooter, links, value }: FooterLinksInputs) {
  const [editing, setEditing] = useState<LinkStep | null>(null)
  const [linkDraft, setLinkDraft] = useState<FooterLink>({ label: '', url: '' })
  const [removing, setRemoving] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [linkKind, setLinkKind] = useState('url')
  function begin(index: number) {
    setEditing({ index, snapshot: structuredClone(footer), fresh: index === (links?.length ?? 0) })
    setLinkDraft(links?.[index] ?? { label: '', url: '' })
    setLinkKind('url')
    setQuery('')
  }
  function close(cancel: boolean) {
    if (cancel && editing) setFooter(editing.snapshot)
    setEditing(null)
  }
  const linkValid = Boolean(
    linkDraft.label.trim() && linkDraft.label.length <= 120 && NavUrl.safeParse(linkDraft.url).success,
  )
  function changeLink(next: FooterLink) {
    setLinkDraft(next)
    if (!editing || !links) return
    const updated = [...links]
    updated[editing.index] = next
    if (next.label.trim() && NavUrl.safeParse(next.url).success) value('links', writeFooterLinks(updated))
  }
  const reorder = useReorderableList({
    mimeType: 'application/x-cms-footer',
    decide: point =>
      flatReorderIntent(
        (links ?? []).map((_, index) => String(index)),
        point,
      ),
    apply: ({ from, to }) => move(from, to),
  })
  function move(from: number, to: number) {
    if (!links || from === to || to < 0 || to >= links.length) return
    const next = [...links]
    const item = next.splice(from, 1)[0]!
    next.splice(to, 0, item)
    value('links', writeFooterLinks(next))
    return `Moved ${item.label} to position ${to + 1}.`
  }
  function moveByKeyboard(from: number, to: number) {
    const message = move(from, to)
    if (message) reorder.announce(message)
  }

  return {
    editing,
    setEditing,
    linkDraft,
    removing,
    setRemoving,
    query,
    setQuery,
    linkKind,
    setLinkKind,
    begin,
    close,
    linkValid,
    changeLink,
    reorder,
    moveByKeyboard,
  }
}
