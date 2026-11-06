import type { CollectionRights } from '../../../../lib/collection-queries.ts'
import type { getStoryListState } from '../../../../lib/stories-workspace.ts'
import { storiesOverview, type StoryFeedUse } from '../../../../lib/stories-overview.ts'
import { storyInSource, storyListLive } from '../../../../lib/story-list.ts'
import { storyDate } from '../../../../lib/stories-model.ts'
import { CoverageTable, type CoverageRow } from '../../../../components/coverage-table.tsx'
import { ButtonLink, Card, Note } from '../../../../components/ui/index.ts'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { storySourceStatusLine } from '../../../../lib/story-source-status.ts'
import { StoriesHeader } from './header.tsx'
import { AddStory } from './add-story.tsx'
import shared from '../../../../components/workspace.module.css'
type State = NonNullable<Awaited<ReturnType<typeof getStoryListState>>>
export function StoriesOverview({
  siteId,
  state,
  rights,
  canCreate,
  uses,
  initialTag,
  leavingOpen = false,
}: {
  siteId: string
  state: State
  rights: CollectionRights
  canCreate: boolean
  uses: StoryFeedUse[]
  initialTag?: string
  leavingOpen?: boolean
}) {
  const { settings, rows } = state,
    base = '/sites/' + siteId + '/stories',
    coverage = storiesOverview(rows, settings, state.publishedSettings, uses),
    live = rows.filter(row => storyListLive(row, state.publishedSettings)).length,
    needsReview = rows.filter(row => storyInSource(row.values) && row.values.reviewed !== true).length
  const items = (stories: typeof rows) =>
    stories.map(row => ({
      id: row.id,
      label: String(row.values.title || '[Untitled story]'),
      href: base + '/' + row.id,
    }))
  const data: CoverageRow[] = [
    ...coverage.groups.map(group => ({
      id: group.id,
      label: group.label,
      count: group.rows.length,
      live: group.live,
      items: items(group.rows),
      uses: group.uses.map(use => ({ id: use.id, label: use.path, href: '/pages/' + use.id })),
      emptyLabel: 'No current stories carry this tag. Add a story or tag one in Stories.',
    })),
    {
      id: '__none',
      label: settings.mainLabel === 'Project Sectors' ? 'No project sector' : 'No main tag',
      count: coverage.noMain.length,
      live: coverage.noMainLive,
      status: {
        label: coverage.noMain.length ? 'Needs tag' : 'All tagged',
        tone: coverage.noMain.length ? 'pending' : 'live',
      },
      items: items(coverage.noMain),
      uses: coverage.noMainUses.map(use => ({ id: use.id, label: use.path, href: '/pages/' + use.id })),
      emptyLabel: 'Every current story has a main tag.',
    },
  ]
  return (
    <>
      <StoriesHeader
        siteId={siteId}
        live={live}
        needsReview={needsReview}
        view="overview"
        sourceStatus={storySourceStatusLine(settings.source, state.sourceStatus)}
        actions={
          <>
            {rights.manageSchema && (
              <ButtonLink variant="secondary" href={base + '/tags'}>
                Manage tags
              </ButtonLink>
            )}
            {canCreate && rights.editEntries && (
              <AddStory
                siteId={siteId}
                collectionId={state.collectionId}
                revision={state.entryRevision}
                catalog={settings}
                media={state.media.filter(asset => asset.status === 'ready' && asset.deliveryUrl !== null)}
              />
            )}
          </>
        }
      />
      {(state.catalogChanged || rows.some(row => row.changed)) && (
        <Note tone="warning">
          Draft changes wait for publishing.{' '}
          {rights.publish && <Link href={'/sites/' + siteId + '/publishing?lists=1'}>Review and publish</Link>}
        </Note>
      )}
      <p className={shared.meta}>
        Every main tag, with how many current stories carry it. Use it to decide what to write next.
      </p>
      <CoverageTable
        label="Stories by main tag"
        groupLabel={settings.mainLabel === 'Project Sectors' ? 'Project sector' : settings.mainLabel}
        rows={data}
        initialOpen={initialTag}
      />
      <div className={shared.grid}>
        <Card title="Leaving feeds soon" density="summary">
          <p className={shared.meta}>
            {coverage.leaving.length} {coverage.leaving.length === 1 ? 'story reaches' : 'stories reach'} 13 months
            within 30 days.
          </p>
          <details open={leavingOpen || undefined}>
            <summary>Leaving soon</summary>
            {coverage.leaving.length ? (
              <ul className={shared.attention}>
                {coverage.leaving.map(item => (
                  <li key={item.row.id}>
                    <Link href={base + '/' + item.row.id}>{String(item.row.values.title || '[Untitled story]')}</Link>
                    <span className={shared.meta}>Last day in feeds: {storyDate(item.leavesOn)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={shared.meta}>No stories reach the feed cutoff in the next 30 days.</p>
            )}
          </details>
        </Card>
        <Card title="Missing a tag" density="summary">
          <p className={shared.meta}>
            {coverage.missing.length} {coverage.missing.length === 1 ? 'story has' : 'stories have'} no{' '}
            {settings.mainLabel === 'Project Sectors' && settings.secondaryLabel === 'Regions'
              ? 'sector or region'
              : 'main or secondary tag'}
            .
          </p>
          {coverage.missing.length > 0 && <Link href={base + '?status=untagged'}>Review missing tags</Link>}
        </Card>
      </div>
      <p className={shared.meta}>
        Current stories are dated within the last 13 months. Live counts use published dates, tags and review settings.
        Choose a tag to see its story titles. A story with several main tags counts in each.
      </p>
    </>
  )
}
