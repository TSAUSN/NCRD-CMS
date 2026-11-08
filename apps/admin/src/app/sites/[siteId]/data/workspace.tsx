'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { NumberImportDialog } from './import-dialog.tsx'
import { DataValue, DataValues, siteDataValues, type DataValue as NumberValue } from '@cms/schema'
import type { SiteSettingsWorkspace } from '../../../../lib/site-settings.ts'
import { savePublicSiteSettings, prepareSiteSettingsPublication } from '../settings/public-settings-actions.ts'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { TextLink } from '../../../../components/ui/text-link.tsx'
import { PageHeader } from '../../../../components/ui/page-header.tsx'
import { ListDetail } from '../../../../components/ui/list-detail.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { Menu } from '../../../../components/ui/menu.tsx'
import { IconMore } from '../../../../components/icons.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { EmptyState, Note } from '../../../../components/ui/feedback.tsx'
import { Badge } from '../../../../components/ui/status-pill.tsx'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import ownedStyles from './workspace-styles.module.css'
import surfaceControlsStyles from '../../../../components/ui/styles/surface-controls.module.css'
type Usage = Record<string, { id: string; title: string }[]>
export function DataValuesWorkspace({
  siteId,
  archived,
  initial,
  usage,
}: {
  siteId: string
  archived: boolean
  initial: SiteSettingsWorkspace
  usage: Usage
}) {
  const router = useRouter(),
    [rows, setRows] = useState(() => siteDataValues(initial.settings)),
    [revision, setRevision] = useState(initial.revision),
    [selected, setSelected] = useState<NumberValue | null>(null),
    [base, setBase] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(false),
    [changed, setChanged] = useState(initial.changed),
    [importing, setImporting] = useState(false),
    [pending, startTransition] = useTransition(),
    busy = useRef(false)
  const dirty = Boolean(selected && JSON.stringify(selected) !== base),
    valid = DataValue.safeParse(selected).success,
    shown = rows.filter(
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
            : [...rows, selected],
        parsed = DataValues.parse(next),
        outcome = await savePublicSiteSettings(siteId, revision, 'dataValues', parsed)
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
  const pageLinks = selected ? (usage[selected.id] ?? []) : [],
    unverified = rows.filter(row => row.status === 'needs-checking').length
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
  return (
    <div className={shared.denseStack}>
      <PageHeader
        title="Data values"
        showWayfinding={false}
        density="compact"
        sub="Numbers used on more than one page. Change one here, publish, and every page that shows it updates."
        actions={
          !selected && !archived ? (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                Fill from a file
              </Button>
              <Button onClick={add}>Add a number</Button>
            </>
          ) : undefined
        }
      />
      {archived && <p role="status">This site is archived. Its numbers remain available in History.</p>}
      {notice && (
        <p role={error ? 'alert' : 'status'} className={error ? 'notice notice-error' : 'notice notice-ok'}>
          {notice}
          {error && (
            <>
              {' '}
              <TextLink href={'/sites/' + siteId + '/data'} target="_blank" rel="noopener">
                Check the saved list in a new tab
              </TextLink>
            </>
          )}
        </p>
      )}
      {pending && (
        <p role="status">Saving the number draft and preparing your next step. This can take up to a minute…</p>
      )}
      {unverified > 0 && (
        <Note tone="warning">
          {unverified} {unverified === 1 ? 'number needs' : 'numbers need'} checking. This status never changes a page
          by itself.
        </Note>
      )}
      <ListDetail
        onClose={() => select(null)}
        label="Number details"
        storageKey="cms-data-values-panel"
        header={
          selected ? (
            <>
              <h2 title={selected.label || 'Add a number'}>{selected.label || 'Add a number'}</h2>
              <div className={workspaceFormsStyles.actions}>
                <Button variant="tertiary" onClick={() => select(null)}>
                  Back
                </Button>
                <Button
                  variant="tertiary"
                  disabled={pending || !valid}
                  onClick={() => (dirty ? save('done') : open(null))}
                >
                  Done
                </Button>
                {!archived && (
                  <Menu label={<IconMore size={16} />} accessibleLabel="Number actions">
                    <Button
                      variant="tertiary"
                      disabled={pending || !rows.some(row => row.id === selected.id) || pageLinks.length > 0}
                      onClick={() => save('save', true)}
                    >
                      Delete
                    </Button>
                    {selected.status !== 'does-not-change' && (
                      <Button variant="tertiary" disabled={pending} onClick={() => update('status', 'matches-report')}>
                        Mark as checked
                      </Button>
                    )}
                  </Menu>
                )}
              </div>
            </>
          ) : undefined
        }
        footer={
          selected && !archived ? (
            <div className={workspaceFormsStyles.actions}>
              <Button variant="secondary" disabled={pending || !valid || !dirty} onClick={() => save('save')}>
                Save draft
              </Button>
              <Button
                variant="secondary"
                disabled={pending || !valid || (!dirty && !changed)}
                onClick={() => save('schedule')}
              >
                Schedule
              </Button>
              <Button
                variant="publish"
                disabled={pending || !valid || (!dirty && !changed)}
                onClick={() => save('publish')}
              >
                Publish
              </Button>
            </div>
          ) : undefined
        }
        panel={
          selected ? (
            <div
              className={shared.denseStack}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  select(null)
                }
              }}
            >
              <Field density="compact" id="data-label" label="What it counts">
                <input
                  value={selected.label}
                  onChange={event => update('label', event.target.value)}
                  maxLength={120}
                  disabled={pending || archived}
                />
              </Field>
              {selected.status === 'does-not-change' && (
                <Note>
                  This number doesn’t change. Choose Needs checking or Matches report before editing its value.
                </Note>
              )}
              <div className={workspaceFormsStyles.formRow}>
                <Field density="compact" id="data-number" label="Value">
                  <input
                    value={selected.value}
                    readOnly={selected.status === 'does-not-change'}
                    onChange={event => update('value', event.target.value)}
                    maxLength={100}
                    disabled={pending || archived}
                  />
                </Field>
                <Field density="compact" id="data-as-of" label="As of">
                  <input
                    value={selected.asOf}
                    onChange={event => update('asOf', event.target.value)}
                    maxLength={60}
                    placeholder="FY2025"
                    disabled={pending || archived}
                  />
                </Field>
              </div>
              <Field density="compact" id="data-unit" label="Label on the page">
                <input
                  value={selected.unit}
                  onChange={event => update('unit', event.target.value)}
                  maxLength={80}
                  disabled={pending || archived}
                />
              </Field>
              <Field
                density="compact"
                id="data-source"
                label="Source"
                help="Required, so the next person knows where it came from."
              >
                <input
                  required
                  value={selected.source}
                  onChange={event => update('source', event.target.value)}
                  maxLength={500}
                  disabled={pending || archived}
                />
              </Field>
              {selected.sourcePageId && <TextLink href={'/pages/' + selected.sourcePageId}>Open source page</TextLink>}
              <label className={selectionControlsStyles.toggleRow}>
                <span>Show the source in small print</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={selected.showSource}
                  onChange={event => update('showSource', event.target.checked)}
                  disabled={pending || archived}
                />
              </label>
              <Field density="compact" id="data-status" label="Status">
                <select
                  value={selected.status}
                  onChange={event => update('status', event.target.value as NumberValue['status'])}
                  disabled={pending || archived}
                >
                  <option value="matches-report">Matches report</option>
                  <option value="needs-checking">Needs checking</option>
                  <option value="does-not-change">Doesn't change</option>
                </select>
              </Field>
              <div className={listInspectorStyles.formStack}>
                <p className={surfaceControlsStyles.help}>Shown on</p>
                {pageLinks.length ? (
                  <div className={workspaceFormsStyles.actions}>
                    {pageLinks.map(page => (
                      <TextLink
                        key={page.id}
                        href={'/pages/' + page.id}
                        className={ownedStyles.linkChip}
                        title={page.title}
                      >
                        {page.title}
                      </TextLink>
                    ))}
                  </div>
                ) : (
                  <p className="hint">No pages use this number yet.</p>
                )}
              </div>
              <Note>
                {pageLinks.length
                  ? 'Save to keep the change private. Publish to update the live pages that use this number.'
                  : 'Save to keep this number private. Publishing it by itself won’t change a public page.'}
              </Note>
            </div>
          ) : undefined
        }
      >
        <div className={shared.denseStack}>
          <div className={reviewWorkbenchStyles.workbenchActions}>
            <div className={workspaceFormsStyles.toolbarField}>
              <Field density="compact" id="data-search" label="Search numbers">
                <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
              </Field>
            </div>
            <Field density="compact" id="data-filter" label="Status">
              <select value={filter} onChange={event => setFilter(event.target.value)}>
                <option value="all">All numbers</option>
                <option value="matches-report">Matches report</option>
                <option value="needs-checking">Needs checking</option>
                <option value="does-not-change">Doesn't change</option>
              </select>
            </Field>
          </div>
          {changed && (
            <p>
              <TextLink href={'/sites/' + siteId + '/publishing'}>Review saved number changes in Publish</TextLink>
            </p>
          )}
          <div className={recordTableStyles.tableWrap} data-responsive="records">
            <table
              data-density="content"
              data-layout="records"
              className={recordTableStyles.table + ' ' + recordTableStyles.compactTable}
            >
              <thead>
                <tr>
                  <th>Number</th>
                  <th data-col="value">Value</th>
                  <th data-secondary data-col="source">
                    Source
                  </th>
                  <th data-secondary data-col="date">
                    As of
                  </th>
                  <th data-col="status">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(row => (
                  <tr key={row.id} aria-selected={selected?.id === row.id}>
                    <td>
                      <Button
                        variant="tertiary"
                        className={recordTableStyles.tableTitle}
                        title={row.label}
                        onClick={() => select(row)}
                      >
                        <span className={recordTableStyles.truncateValue}>{row.label}</span>
                      </Button>
                      <p className={recordTableStyles.meta}>
                        Used on {usage[row.id]?.length ?? 0} {(usage[row.id]?.length ?? 0) === 1 ? 'page' : 'pages'}
                      </p>
                    </td>
                    <td>
                      <strong
                        className={recordTableStyles.numberValue + ' ' + recordTableStyles.truncateValue}
                        title={row.value}
                      >
                        {row.value}
                      </strong>
                    </td>
                    <td data-secondary className={surfaceControlsStyles.help}>
                      <span className={recordTableStyles.truncateValue} title={row.source}>
                        {row.source}
                      </span>
                    </td>
                    <td data-secondary data-col="date" className={surfaceControlsStyles.help}>
                      <span className={recordTableStyles.truncateValue} title={row.asOf || 'Unknown'}>
                        {row.asOf || 'Unknown'}
                      </span>
                    </td>
                    <td>
                      <Badge
                        tone={
                          row.status === 'matches-report'
                            ? 'live'
                            : row.status === 'needs-checking'
                              ? 'pending'
                              : 'neutral'
                        }
                      >
                        {row.status === 'matches-report'
                          ? 'Matches report'
                          : row.status === 'needs-checking'
                            ? 'Needs checking'
                            : "Doesn't change"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && (
              <EmptyState title={rows.length ? 'No matching numbers' : 'No numbers yet'}>
                {rows.length
                  ? 'Try another search or status.'
                  : 'Add a number with its source, then choose it on a page.'}
              </EmptyState>
            )}
          </div>
        </div>
      </ListDetail>
      {importing && (
        <NumberImportDialog siteId={siteId} current={rows} onClose={() => setImporting(false)} onApply={applyFile} />
      )}
    </div>
  )
}
