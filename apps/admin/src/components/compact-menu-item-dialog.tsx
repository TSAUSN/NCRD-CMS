import { NavUrl, type NavNode, type NavTree } from '@cms/schema'
import { Button, Dialog, Field, SegmentedControl, SearchableSelect } from './ui/index.ts'
import listInspectorStyles from './workspace-styles/list-inspector.module.css'

export type MenuPageChoice = { id: string; title: string; path: string; published: boolean }
export type MenuItemEditing = { path: string; snapshot: NavTree; fresh: boolean; kind: 'page' | 'url' | 'group' }

export function CompactMenuItemDialog({
  editing,
  node,
  pages,
  pageById,
  close,
  kind,
  valid,
  patch,
  labelEdited,
  setLabelEdited,
}: {
  editing: MenuItemEditing
  node: NavNode
  pages: MenuPageChoice[]
  pageById: ReadonlyMap<string, MenuPageChoice>
  close: (cancel: boolean) => void
  kind: (value: MenuItemEditing['kind']) => void
  valid: boolean
  patch: (update: (node: NavNode) => NavNode) => void
  labelEdited: boolean
  setLabelEdited: (edited: boolean) => void
}) {
  return (
    <Dialog
      density="compact"
      size="medium"
      title={editing.fresh ? 'Add to menu' : 'Edit menu item'}
      onClose={() => close(true)}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(true)}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => close(false)}>
            Done
          </Button>
        </>
      }
    >
      <div className={listInspectorStyles.formStack}>
        {editing.fresh && (
          <SegmentedControl
            appearance="pills"
            size="s"
            label="What would you like to add?"
            value={editing.kind}
            onChange={value => kind(value as MenuItemEditing['kind'])}
            options={[
              { value: 'page', label: 'A page on this site' },
              { value: 'url', label: 'A website' },
              { value: 'group', label: 'A dropdown group' },
            ]}
          />
        )}
        {(editing.kind === 'page' || (editing.kind === 'group' && editing.fresh)) && (
          <SearchableSelect
            key={editing.kind}
            id="menu-item-page"
            label={editing.kind === 'group' ? 'First page in this dropdown' : 'Page'}
            required
            autoFocus
            help={
              editing.kind === 'group'
                ? 'A dropdown needs a real link. Add more links after this.'
                : 'Type a page title or address, then choose a suggestion.'
            }
            value={
              editing.kind === 'group'
                ? node.children?.[0]?.target.type === 'page'
                  ? node.children[0].target.page_id
                  : ''
                : node.target.type === 'page'
                  ? node.target.page_id
                  : ''
            }
            options={pages.map(page => ({
              value: page.id,
              label: page.title + ' — ' + page.path + (page.published ? '' : ' · draft'),
            }))}
            onChange={id => {
              const page = pageById.get(id)
              patch(current =>
                editing.kind === 'group'
                  ? {
                      ...current,
                      children: page
                        ? [
                            {
                              label: page.title.slice(0, 80),
                              target: { type: 'page', page_id: page.id },
                              visible: true,
                            },
                          ]
                        : [],
                    }
                  : {
                      ...current,
                      label: page && !labelEdited ? page.title.slice(0, 80) : current.label,
                      target: { type: 'page', page_id: page?.id ?? '' },
                    },
              )
            }}
          />
        )}
        <Field id="menu-item-name" label="Menu label" required>
          <input
            autoFocus={editing.kind === 'url' || (editing.kind === 'group' && !editing.fresh)}
            value={node.label}
            maxLength={80}
            onChange={event => {
              setLabelEdited(true)
              patch(current => ({ ...current, label: event.target.value }))
            }}
          />
        </Field>
        {editing.kind === 'url' && (
          <Field
            id="menu-item-url"
            label="Web address"
            required
            error={
              node.target.type === 'url' && node.target.url && !NavUrl.safeParse(node.target.url).success
                ? 'Use /path or https://example.org.'
                : undefined
            }
          >
            <input
              value={node.target.type === 'url' ? node.target.url : ''}
              maxLength={2048}
              onChange={event => patch(current => ({ ...current, target: { type: 'url', url: event.target.value } }))}
            />
          </Field>
        )}

        {editing.kind === 'group' && (
          <p className="muted">Opens the links below it. The group has no web address of its own.</p>
        )}
        {!valid && (
          <p role="status" className="muted">
            Complete the name and destination to show this item in the preview.
          </p>
        )}
      </div>
    </Dialog>
  )
}
