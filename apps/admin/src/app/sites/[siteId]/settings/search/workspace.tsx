'use client'
import { parseSiteVerificationTags, formatSiteVerificationTags, type SitePublicSettings } from '@cms/schema'
import type { SiteSettingsWorkspace } from '../../../../../lib/site-settings.ts'
import { Card } from '../../../../../components/ui/card.tsx'
import { Field } from '../../../../../components/ui/field.tsx'
import { ButtonLink } from '../../../../../components/ui/button-link.tsx'
import { SettingsEditor, useSettingsDraft } from '../settings-editor.tsx'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../../components/workspace-styles/record-table.module.css'
type SearchInput = { tags: string; hints: string }
function input(payload: unknown): SearchInput {
  const search = payload as SitePublicSettings['search']
  return {
    tags: formatSiteVerificationTags(search?.verification ?? []).replaceAll('\n', ' '),
    hints: search?.hints ?? '',
  }
}
export function SearchSharingWorkspace({
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
    'search',
    'Search & sharing',
    input(initial.settings.search),
    value => {
      const verification = parseSiteVerificationTags(value.tags)
      return verification ? { verification, hints: value.hints } : null
    },
    input,
    'Use a quoted verification tag from Google, Bing, Yandex or Pinterest.',
  )
  const value = draft.value
  return (
    <SettingsEditor
      siteId={siteId}
      siteName={siteName}
      archived={archived}
      current="Search & sharing"
      path="/search"
      draft={draft}
    >
      <Card title="Search & sharing" density="editor">
        <Field id="site-verification-tags" label="Site verification tags">
          <input
            id="site-verification-tags"
            aria-describedby="site-verification-tags-help"
            value={value.tags}
            maxLength={4096}
            disabled={archived || draft.pending}
            placeholder="[paste the tag from the search service]"
            onChange={event => draft.change(current => ({ ...current, tags: event.target.value }))}
          />
          <p className="hint" id="site-verification-tags-help">
            Paste the tag supplied by your search service. It verifies ownership separately.
          </p>
        </Field>
        <Field
          id="site-search-hints"
          label="Search keywords (optional)"
          help="Adds a keywords tag to published pages. Google Search ignores this tag."
          helpAfter
        >
          <input
            id="site-search-hints"
            placeholder="[optional]"
            value={value.hints}
            maxLength={500}
            disabled={archived || draft.pending}
            onChange={event => draft.change(current => ({ ...current, hints: event.target.value }))}
          />
        </Field>
        <div className={workspaceFormsStyles.actions}>
          <div className={recordTableStyles.rowCopy}>
            <span>Sitemap</span>
            <span className="hint">Updates by itself each time you publish.</span>
          </div>
          <ButtonLink
            variant="secondary"
            size="s"
            href={'/sites/' + siteId + '/settings/sitemap'}
            target="_blank"
            rel="noopener"
          >
            View sitemap
          </ButtonLink>
        </div>
        <p className="hint">Each page’s description is set on the page. Canonical tags are set for you.</p>
        <p className="hint">
          The sitemap preview includes published pages. A public sitemap appears on a live address; staging stays out of
          search results.
        </p>
        {!draft.valid && <p role="alert">Use a quoted verification tag from Google, Bing, Yandex or Pinterest.</p>}
      </Card>
    </SettingsEditor>
  )
}
