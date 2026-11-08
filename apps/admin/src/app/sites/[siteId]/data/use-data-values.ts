import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DataValue, DataValues, siteDataValues, type DataValue as NumberValue } from '@cms/schema'
import type { SiteSettingsWorkspace } from '../../../../lib/site-settings.ts'
import { savePublicSiteSettings, prepareSiteSettingsPublication } from '../settings/public-settings-actions.ts'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'

type Usage = Record<string, { id: string; title: string }[]>
export type DataValuesProps = {
  siteId: string
  archived: boolean
  initial: SiteSettingsWorkspace
  usage: Usage
}

export const NUMBER_STATUS_LABELS = {
  'matches-report': 'Matches report',
  'needs-checking': 'Needs checking',
  'does-not-change': "Doesn't change",
} satisfies Record<NumberValue['status'], string>

export function useDataValues({ siteId, archived, initial, usage }: DataValuesProps) {
  const router = useRouter()
  const [rows, setRows] = useState(() => siteDataValues(initial.settings))
  const [revision, setRevision] = useState(initial.revision)
  const [selected, setSelected] = useState<NumberValue | null>(null)
  const [base, setBase] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(false)
  const [changed, setChanged] = useState(initial.changed)
  const [importing, setImporting] = useState(false)
  const [pending, startTransition] = useTransition()
  const busy = useRef(false)
  const dirty = Boolean(selected && JSON.stringify(selected) !== base)
  const valid = DataValue.safeParse(selected).success
  const shown = rows.filter(
    row =>
      (filter === 'all' || row.status === filter) &&
      (row.label + ' ' + row.value + ' ' + row.source).toLowerCase().includes(search.toLowerCase()),
  )
  async function persist(remove = false) {
    if (!selected || busy.current || archived || !valid)
      return { ok: false, message: 'Add a label, value and source before saving.' }
    busy.current = true
    try {
      const next = remove
        ? rows.filter(row => row.id !== selected.id)
        : rows.some(row => row.id === selected.id)
          ? rows.map(row => (row.id === selected.id ? selected : row))
          : [...rows, selected]
      const parsed = DataValues.parse(next)
      const outcome = await savePublicSiteSettings(siteId, revision, 'dataValues', parsed)
      setNotice(outcome.ok ? 'Number draft saved. Review it in Publish before it goes live.' : outcome.message)
      setError(!outcome.ok)
      if (!outcome.ok) return outcome
      setRows(siteDataValues(outcome.settings))
      setRevision(outcome.revision)
      setChanged(true)
      setBase(JSON.stringify(selected))
      if (remove) setSelected(null)
      return { ok: true, revision: outcome.revision }
    } catch {
      setError(true)
      setNotice('The save could not be confirmed. Your fields are kept. Check the saved list before retrying.')
      return { ok: false, message: 'The save could not be confirmed.' }
    } finally {
      busy.current = false
    }
  }
  const leave = () => ({
    dirty,
    pending: pending || busy.current,
    draft: {
      label: 'Data values',
      saveDraft: () => persist(),
      discard: () => {
        setSelected(null)
      },
    },
  })
  useNavigationGuard(leave)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  function select(row: NumberValue | null, isNew = false) {
    if (requestLocalDraftNavigation(leave, () => open(row, isNew))) open(row, isNew)
  }
  function open(row: NumberValue | null, isNew = false) {
    setSelected(row)
    setBase(isNew ? 'null' : JSON.stringify(row))
    setNotice('')
  }
  function add() {
    select(
      {
        id: crypto.randomUUID(),
        label: '',
        value: '',
        unit: '',
        source: '',
        sourcePageId: null,
        asOf: '',
        status: 'needs-checking',
        showSource: false,
      },
      true,
    )
  }
  function update<K extends keyof NumberValue>(key: K, value: NumberValue[K]) {
    setSelected(current => (current ? { ...current, [key]: value } : null))
    setNotice('')
  }
  function save(intent: 'save' | 'schedule' | 'publish' | 'done', remove = false) {
    startTransition(async () => {
      const saved = await persist(remove)
      if (!saved.ok) return
      if (intent === 'done') setSelected(null)
      if (intent === 'schedule' || intent === 'publish') {
        const result = await prepareSiteSettingsPublication(
          siteId,
          'revision' in saved ? String(saved.revision) : revision,
          crypto.randomUUID(),
        )
        if (!result.ok) {
          setError(true)
          setNotice(result.message)
          return
        }
        router.push(
          '/sites/' +
            siteId +
            '/publishing?release=' +
            result.releaseId +
            (intent === 'schedule' ? '&intent=schedule' : ''),
        )
      }
    })
  }
  const pageLinks = selected ? (usage[selected.id] ?? []) : []
  const unverified = rows.filter(row => row.status === 'needs-checking').length
  async function applyFile(next: NumberValue[]) {
    const result = await savePublicSiteSettings(siteId, revision, 'dataValues', next)
    if (result.ok) {
      setRows(siteDataValues(result.settings))
      setRevision(result.revision)
      setChanged(true)
      setImporting(false)
      setNotice(result.message)
      setError(false)
    }
    return result
  }

  return {
    siteId,
    archived,
    usage,
    rows,
    shown,
    selected,
    search,
    setSearch,
    filter,
    setFilter,
    notice,
    error,
    changed,
    importing,
    setImporting,
    pending,
    dirty,
    valid,
    pageLinks,
    unverified,
    select,
    open,
    add,
    update,
    save,
    applyFile,
  }
}

export type DataValuesModel = ReturnType<typeof useDataValues>
