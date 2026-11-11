'use client'
import { GuardedLink as Link } from '../../../../../components/guarded-link.tsx'
import { ReorderAnnouncement } from '../../../../../components/ui/drop-indicator.tsx'
import { Badge, Button, ButtonLink, Note, PageHeader } from '../../../../../components/ui/index.ts'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../../components/workspace-styles/record-table.module.css'
import { useTagManager, type TagManagerProps } from './use-tag-manager.ts'
import { StoryTagLevel } from './story-tag-level.tsx'
import { StoryTagDialogs } from './story-tag-dialogs.tsx'
export function TagManager(props: TagManagerProps) {
  const { siteId } = props
  const model = useTagManager(props)
  const { pending, hasDraft, dirty, setConfirmSuggestions, message, error, reorder } = model
  const tagChecks = (['main', 'secondary'] as const).flatMap(group =>
    model.tags(group).map(tag => ({
      label: tag.label,
      noKeywords: tag.keywords.length === 0,
      unused: model.count(group, tag.id) === 0,
    })),
  )
  const withoutKeywords = tagChecks.filter(tag => tag.noKeywords)
  const unassigned = tagChecks.filter(tag => tag.unused)
  return (
    <>
      <PageHeader
        density="compact"
        showWayfinding={false}
        title="Manage tags"
        lede="Main tags and secondary tags work on every site. Each site names its own."
        actions={
          <>
            <span role="status">
              {pending ? (
                'Saving…'
              ) : (
                <Badge tone={hasDraft ? 'pending' : 'live'}>{hasDraft ? 'Saved as a draft' : 'Live'}</Badge>
              )}
            </span>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirmSuggestions(true)}>
              Re-suggest tags for unreviewed stories
            </Button>
            <ButtonLink
              variant="publish"
              href={'/sites/' + siteId + '/publishing?lists=1'}
              aria-disabled={pending || dirty}
              onClick={event => {
                if (pending || dirty) event.preventDefault()
              }}
            >
              Publish…
            </ButtonLink>
          </>
        }
      />
      {message && (
        <Note tone={error ? 'warning' : 'success'}>
          <span role={error ? 'alert' : 'status'}>{message}</span>
        </Note>
      )}

      <Note>
        Keywords suggest tags; editors review the assignments before publishing. Re-suggest only changes unreviewed
        stories. <Link href="/help?topic=stories">How story tagging works</Link>
      </Note>
      {withoutKeywords.length > 0 && (
        <Note tone="warning">
          No suggestion keywords: {withoutKeywords.map(tag => tag.label).join(', ')}. These tags can still be assigned
          manually.
        </Note>
      )}
      {unassigned.length > 0 && (
        <Note>
          No stories assigned: {unassigned.map(tag => tag.label).join(', ')}. Review relevant stories and their tags
          before publishing.
        </Note>
      )}
      <StoryTagLevel model={model} group="main" />
      <StoryTagLevel model={model} group="secondary" />
      <div className={workspaceFormsStyles.actions}>
        <ButtonLink variant="secondary" href={'/sites/' + siteId + '/stories'}>
          Done
        </ButtonLink>
        <span className={recordTableStyles.meta}>
          Drag the grip to reorder. With the grip focused, use Alt + Up or Down.
        </span>
      </div>
      <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>

      <StoryTagDialogs model={model} />
    </>
  )
}
