'use client'
import { type SiteAnalytics } from '@cms/schema'
import type { SiteSettingsWorkspace } from '../../../../../lib/site-settings.ts'
import { Card, Field, Note } from '../../../../../components/ui/index.ts'
import { SettingsEditor, useSettingsDraft } from '../settings-editor.tsx'

function input(payload: unknown): SiteAnalytics {
  const analytics = payload as SiteAnalytics | undefined
  return analytics ?? { measurementId: '', enabled: false, includeStaging: false }
}
export function AnalyticsWorkspace({
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
    'analytics',
    'Analytics',
    input(initial.settings.analytics),
    value => value,
    input,
    'Add a valid GA4 Measurement ID before enabling tracking.',
  )
  const value = draft.value
  return (
    <SettingsEditor
      siteId={siteId}
      siteName={siteName}
      archived={archived}
      current="Analytics"
      path="/analytics"
      draft={draft}
    >
      <Card title="Google Analytics" density="editor">
        <p>
          Connect this site to its own GA4 web data stream. Create the property in Google Analytics, then enter its
          Measurement ID here.
        </p>
        <Field
          id="ga4-measurement-id"
          label="GA4 Measurement ID"
          help="Starts with G-. This is different from the numeric property ID used for reports."
          helpAfter
        >
          <input
            id="ga4-measurement-id"
            value={value.measurementId}
            maxLength={22}
            placeholder="G-XXXXXXXXXX"
            autoComplete="off"
            spellCheck={false}
            disabled={archived || draft.pending}
            onChange={event => draft.change(current => ({ ...current, measurementId: event.target.value }))}
          />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={value.enabled}
            disabled={archived || draft.pending}
            onChange={event => draft.change(current => ({ ...current, enabled: event.target.checked }))}
          />{' '}
          Enable tracking on published pages
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.includeStaging}
            disabled={archived || draft.pending}
            onChange={event => draft.change(current => ({ ...current, includeStaging: event.target.checked }))}
          />{' '}
          Also collect on test addresses
        </label>
        <Note>
          Save draft keeps these choices private. Review and publish the settings to change tracking. CMS screens and
          private previews never send Analytics events through this integration.
        </Note>
        {value.enabled && !value.includeStaging && (
          <p className="hint">
            Test addresses remain excluded. Turn on the test-address option only if you want their traffic in this
            property.
          </p>
        )}
        <p className="hint">
          View collected data in Google Analytics. Reports inside the CMS are a later connection and are not enabled by
          a Measurement ID alone.
        </p>
        {!draft.valid && <p role="alert">Use a GA4 Measurement ID such as G-XXXXXXXXXX, or leave tracking off.</p>}
      </Card>
    </SettingsEditor>
  )
}
