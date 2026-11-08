import { Button, Field, TextLink, Badge, EmptyState } from '../../../../components/ui/index.ts'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import surfaceControlsStyles from '../../../../components/ui/styles/surface-controls.module.css'
import { NUMBER_STATUS_LABELS, type DataValuesModel } from './use-data-values.ts'

export function DataValuesTable({ model }: { model: DataValuesModel }) {
  const { search, setSearch, filter, setFilter, changed, siteId, shown, selected, select, usage, rows } = model
  return (
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
            {Object.entries(NUMBER_STATUS_LABELS).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
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
                      row.status === 'matches-report' ? 'live' : row.status === 'needs-checking' ? 'pending' : 'neutral'
                    }
                  >
                    {NUMBER_STATUS_LABELS[row.status]}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <EmptyState title={rows.length ? 'No matching numbers' : 'No numbers yet'}>
            {rows.length ? 'Try another search or status.' : 'Add a number with its source, then choose it on a page.'}
          </EmptyState>
        )}
      </div>
    </div>
  )
}
