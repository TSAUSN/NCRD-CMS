import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CORE_PAGE_TEMPLATES, coreTemplateSectionOptions } from '@cms/seeds/core-templates'
import { duplicatePageAction } from '../../pages/[pageId]/page-copy-actions.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'

export type PageSource = { id: string; title: string; revision: string }
export type StartMode = 'starter' | 'blank' | 'custom'
export const MAX_STARTER_SECTIONS = 12
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function templateSectionIds(library: LibraryEntry[], templateId: string): string[] {
  const template = CORE_PAGE_TEMPLATES.find(template => template.id === templateId)
  return (
    template?.sections.flatMap(slug => {
      const section = library.find(entry => entry.slug === `core-${slug}`)
      return section ? [section.section_def_id] : []
    }) ?? []
  )
}

export function usePageDetails() {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [touchedSlug, setTouchedSlug] = useState(false)
  const suggested = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const effective = touchedSlug ? slug : suggested
  const slugProblem =
    effective !== '' && !SLUG.test(effective)
      ? 'Use lowercase letters, numbers and hyphens — for example about-us.'
      : null

  return {
    title,
    setTitle,
    address: effective,
    slugProblem,
    editAddress(value: string) {
      setTouchedSlug(true)
      setSlug(value)
    },
  }
}

export function usePageStartingPoint(library: LibraryEntry[], designs: PageSource[]) {
  const recommended = useMemo(() => templateSectionIds(library, 'landing'), [library])
  const [pageTemplate, setPageTemplate] = useState('landing')
  const [mode, setMode] = useState<StartMode>(library.length > 0 ? 'starter' : 'blank')
  const [selectedIds, setSelectedIds] = useState<string[]>(recommended)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const entries = useMemo(() => new Map(library.map(entry => [entry.section_def_id, entry])), [library])
  const selected = selectedIds.flatMap(id => {
    const entry = entries.get(id)
    if (!entry) return []
    const options = coreTemplateSectionOptions(pageTemplate, entry.slug ?? '')
    return [{ ...entry, name: options?.label ?? entry.name, startsHidden: options?.hidden ?? false }]
  })
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of library) {
      const name = entry.category || 'Other'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [library])
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return library.filter(entry => {
      if (category && (entry.category || 'Other') !== category) return false
      if (!term) return true
      return `${entry.name} ${entry.slug} ${entry.category}`.toLowerCase().includes(term)
    })
  }, [library, search, category])

  const [copyMode, setCopyMode] = useState(false)
  const [designId, setDesignId] = useState(designs[0]?.id ?? '')
  const [copyId, setCopyId] = useState('')

  function selectTemplate(id: string) {
    setPageTemplate(id)
    setSelectedIds(templateSectionIds(library, id))
    setMode(id === 'blank' ? 'blank' : 'starter')
  }

  function chooseMode(next: StartMode) {
    setMode(next)
    if (next === 'blank') selectTemplate('blank')
    if (next === 'starter') selectTemplate(pageTemplate === 'blank' ? 'landing' : pageTemplate)
    if (next === 'custom' && mode === 'blank') setSelectedIds([])
  }

  function toggleSection(id: string) {
    setMode('custom')
    setSelectedIds(current => {
      if (current.includes(id)) return current.filter(candidate => candidate !== id)
      if (current.length >= MAX_STARTER_SECTIONS) return current
      return [...current, id]
    })
  }

  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= selectedIds.length) return
    setMode('custom')
    setSelectedIds(current => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }

  function selectStartingPoint(value: string) {
    setCopyMode(value === 'copy')
    setDesignId(value === 'template' ? (designs[0]?.id ?? '') : '')
    chooseMode(value === 'blank' ? 'blank' : 'starter')
  }

  function chooseSectionsInstead() {
    setDesignId('')
    chooseMode('custom')
  }

  return {
    mode,
    pageTemplate,
    selectedIds,
    selected,
    recommended,
    library,
    designs,
    copyMode,
    designId,
    copyId,
    setCopyId,
    setDesignId,
    search,
    setSearch,
    category,
    setCategory,
    categories,
    shown,
    selectStartingPoint,
    selectTemplate,
    chooseMode,
    chooseSectionsInstead,
    toggleSection,
    moveSection,
  }
}

export type PageStartingPoint = ReturnType<typeof usePageStartingPoint>

export function useCopyPage(pages: PageSource[], { title, address }: ReturnType<typeof usePageDetails>) {
  const router = useRouter()
  const [copyPending, setCopyPending] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  async function copy(sourceId: string) {
    const page = pages.find(page => page.id === sourceId)
    if (!page || copyPending) return
    setCopyPending(true)
    setCopyError(null)
    try {
      const result = await duplicatePageAction(page.id, Number(page.revision), { title, address })
      if (result.ok) router.push('/pages/' + result.pageId)
      else setCopyError(result.message)
    } catch {
      setCopyError('The copy could not be confirmed. Check Pages before trying again.')
    } finally {
      setCopyPending(false)
    }
  }

  return { copy, copyPending, copyError }
}
