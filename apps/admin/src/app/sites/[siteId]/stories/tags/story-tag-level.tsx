import { DropIndicator } from '../../../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../../../components/ui/reorderable-list.module.css'
import { type StoryTagGroup } from '@cms/schema'
import { Badge, Button, Card, EmptyState, IconButton, Menu } from '../../../../../components/ui/index.ts'
import { IconDrag, IconPlus, IconTrash } from '../../../../../components/icons.tsx'
import { CatalogList, CatalogRow } from '../../../../../components/catalog-row.tsx'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import type { TagManagerModel } from './use-tag-manager.ts'
export function StoryTagLevel({ model, group }: { model: TagManagerModel; group: StoryTagGroup }) {
  const { settings, setRename, setDeleting, setMessage, pending, tags, tagKey, reorder, count, move, begin } = model
  return (
    <>
      <Card
        key={group}
        density="catalog"
        title={
          <span className={workspaceFormsStyles.actions}>
            {group === 'main' ? settings.mainLabel : settings.secondaryLabel}
            <Badge>{group === 'main' ? 'Main tag' : 'Secondary tag'}</Badge>
          </span>
        }
        description={
          group === 'main'
            ? 'Each one can have its own page. A story can carry several.'
            : 'Used for filters and World View.'
        }
        headerActions={
          <>
            <Button
              variant="secondary"
              size="s"
              disabled={pending}
              onClick={() => {
                setMessage('')
                setRename({ group, label: group === 'main' ? settings.mainLabel : settings.secondaryLabel })
              }}
            >
              Rename level
            </Button>
            <Button
              variant="secondary"
              size="s"
              disabled={pending || tags(group).length >= 100}
              onClick={() => begin(group, null)}
            >
              <IconPlus size={16} />
              {group === 'main' && settings.mainLabel === 'Project Sectors'
                ? 'Add sector'
                : group === 'secondary' && settings.secondaryLabel === 'Regions'
                  ? 'Add region'
                  : 'Add tag'}
            </Button>
          </>
        }
      >
        {tags(group).length ? (
          <CatalogList
            aria-label={group === 'main' ? settings.mainLabel : settings.secondaryLabel}
            className={reorderStyles.list}
            data-reorder-list
          >
            {tags(group).map((tag, index) => (
              <CatalogRow
                descriptionWrap
                key={tag.id}
                data-group={group}
                data-tag-id={tag.id}
                {...reorder.row(tagKey(group, tag.id), pending, false)}
                leading={
                  <>
                    <DropIndicator marker={reorder.marker} row={tagKey(group, tag.id)} />
                    {(reorder.blocked ?? reorder.rejection)?.row === tagKey(group, tag.id) && (
                      <span className={reorderStyles.reason} aria-hidden="true">
                        {(reorder.blocked ?? reorder.rejection)?.message}
                      </span>
                    )}
                    <IconButton
                      tooltip={'Reorder ' + tag.label}
                      variant="tertiary"
                      size="s"
                      disabled={pending}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      {...reorder.grip(tagKey(group, tag.id), pending)}
                      onKeyDown={event => {
                        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                          event.preventDefault()
                          const next = event.key === 'ArrowUp' ? index - 1 : index + 2
                          if (
                            (event.key === 'ArrowUp' && index === 0) ||
                            (event.key === 'ArrowDown' && index === tags(group).length - 1)
                          )
                            return
                          const moved = move(group, tag.id, tags(group)[next]?.id ?? null)
                          if (moved) reorder.announce(moved)
                        }
                      }}
                    >
                      <IconDrag size={16} />
                    </IconButton>
                  </>
                }
                title={
                  <>
                    <strong title={tag.label}>{tag.label}</strong>
                    <small title={tag.id}>{tag.id}</small>
                  </>
                }
                description={
                  <span title={tag.keywords.join(', ')}>
                    {tag.keywords.length ? tag.keywords.join(', ') : 'No keyword suggestions'}
                  </span>
                }
                meta={count(group, tag.id) + ' ' + (count(group, tag.id) === 1 ? 'story' : 'stories')}
                actions={
                  <Menu label="•••" accessibleLabel={'Actions for ' + tag.label}>
                    <Button
                      variant="tertiary"
                      size="s"
                      disabled={pending}
                      aria-label={'Rename ' + tag.label}
                      onClick={() => begin(group, tag.id)}
                    >
                      Rename
                    </Button>
                    <Button
                      aria-label={'Delete ' + tag.label}
                      variant="tertiary"
                      size="s"
                      disabled={pending}
                      onClick={() => {
                        setMessage('')
                        setDeleting({
                          group,
                          id: tag.id,
                          label: tag.label,
                          replacement: tags(group).find(t => t.id !== tag.id)?.id ?? null,
                        })
                      }}
                    >
                      <IconTrash size={16} />
                      Delete
                    </Button>
                  </Menu>
                }
              />
            ))}
          </CatalogList>
        ) : (
          <EmptyState title="No tags yet">Add a tag to begin organizing this site’s stories.</EmptyState>
        )}
      </Card>
    </>
  )
}
