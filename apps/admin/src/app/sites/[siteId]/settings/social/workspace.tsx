'use client'
import { SITE_SOCIAL_LABELS, type SiteSocialAccount } from '@cms/schema'
import type { SiteSettingsWorkspace } from '../../../../../lib/site-settings.ts'
import { Card } from '../../../../../components/ui/card.tsx'
import { SettingsEditor, useSettingsDraft } from '../settings-editor.tsx'
import recordTableStyles from '../../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../../components/workspace-styles/selection-controls.module.css'
export function SocialAccountsWorkspace({
  siteId,
  siteName,
  archived,
  initial,
}: {
  siteId: string
  siteName: string
  archived: boolean
  initial: SiteSettingsWorkspace
}) {
  const draft = useSettingsDraft(
      siteId,
      archived,
      initial,
      'social',
      'Social accounts',
      initial.social,
      value => value,
      payload => payload as SiteSocialAccount[],
      'Use an https address for each shown account and a handle without spaces.',
    ),
    accounts = draft.value,
    pending = draft.pending,
    valid = draft.valid
  function change(service: SiteSocialAccount['service'], key: keyof SiteSocialAccount, value: unknown) {
    draft.change(rows => rows.map(row => (row.service === service ? { ...row, [key]: value } : row)))
  }
  return (
    <SettingsEditor
      siteId={siteId}
      siteName={siteName}
      archived={archived}
      current="Social accounts"
      path="/social"
      draft={draft}
    >
      <Card title="Social accounts" density="editor">
        <p className="hint">
          One place for this site’s accounts. The footer and social sections read from here, so one change updates every
          page after Publish.
        </p>
        <table className={recordTableStyles.table} data-layout="fields">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Address</th>
              <th scope="col">Handle</th>
              <th scope="col">In footer</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(row => (
              <tr key={row.service}>
                <th scope="row">{SITE_SOCIAL_LABELS[row.service]}</th>
                <td>
                  <input
                    type="url"
                    aria-label={SITE_SOCIAL_LABELS[row.service] + ' address'}
                    value={row.url}
                    maxLength={2048}
                    disabled={pending || archived}
                    placeholder="https://"
                    onChange={event => change(row.service, 'url', event.target.value)}
                  />
                </td>
                <td>
                  {['facebook', 'instagram', 'x'].includes(row.service) || row.handle ? (
                    <input
                      aria-label={SITE_SOCIAL_LABELS[row.service] + ' handle'}
                      value={row.handle}
                      maxLength={100}
                      disabled={pending || archived}
                      placeholder="@handle"
                      onChange={event => change(row.service, 'handle', event.target.value)}
                    />
                  ) : null}
                </td>
                <td>
                  <label className={selectionControlsStyles.toggleRow}>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={SITE_SOCIAL_LABELS[row.service] + ' in footer'}
                      checked={row.inFooter}
                      disabled={pending || archived}
                      onChange={event => change(row.service, 'inFooter', event.target.checked)}
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!valid && (
          <p role="alert">
            Use an https address for each account you show, and a handle without spaces. Clear the handle and switch In
            footer off when removing an address.
          </p>
        )}
      </Card>
    </SettingsEditor>
  )
}
