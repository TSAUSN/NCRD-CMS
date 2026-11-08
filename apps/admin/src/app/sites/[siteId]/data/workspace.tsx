'use client'
import { NumberImportDialog } from './import-dialog.tsx'
import { Button, ListDetail, Menu, Note, PageHeader, TextLink } from '../../../../components/ui/index.ts'
import { IconMore } from '../../../../components/icons.tsx'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import { useDataValues, type DataValuesProps } from './use-data-values.ts'
import { DataValuesTable } from './data-values-table.tsx'
import { DataValueFields } from './data-value-fields.tsx'

export function DataValuesWorkspace(props: DataValuesProps) {
  const model = useDataValues(props)
  const {
    siteId,
    archived,
    rows,
    selected,
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
  } = model
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
        panel={selected ? <DataValueFields model={model} selected={selected} /> : undefined}
      >
        <DataValuesTable model={model} />
      </ListDetail>
      {importing && (
        <NumberImportDialog siteId={siteId} current={rows} onClose={() => setImporting(false)} onApply={applyFile} />
      )}
    </div>
  )
}
