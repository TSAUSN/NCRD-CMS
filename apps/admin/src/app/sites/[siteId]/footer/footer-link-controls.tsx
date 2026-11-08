import { DropIndicator, ReorderAnnouncement } from '../../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../../components/ui/reorderable-list.module.css'
import { writeFooterLinks } from '../../../../lib/footer-links.ts'
import { Button, Card, Dialog, Field, Menu, Note, SegmentedControl } from '../../../../components/ui/index.ts'
import { IconDrag, IconMore, IconPlus } from '../../../../components/icons.tsx'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import type { FooterDraft, FooterWorkspaceProps } from './use-footer-draft.ts'
import { FooterTextField } from './footer-content-cards.tsx'
export function FooterLinkList({ model }: { model: FooterDraft }) {
  const { pending, links } = model
  const { setRemoving, begin, reorder, moveByKeyboard } = model.linkControls
  return (
    <>
      <Card
        title="Links"
        density="editor"
        headerActions={
          <Button
            variant="secondary"
            disabled={pending || links === null || links.length >= 50}
            onClick={() => begin(links!.length)}
          >
            <IconPlus size={16} />
            Add
          </Button>
        }
      >
        {links === null ? (
          <div className={listInspectorStyles.formStack}>
            <Note>These links include extra formatting. Edit the existing text here to keep every word and link.</Note>
            <FooterTextField model={model} id="links" label="Footer links" />
          </div>
        ) : links.length ? (
          <ul className={siteSummaryStyles.rowList + ' ' + reorderStyles.list} data-reorder-list>
            {links.map((link, index) => (
              <li key={index} className={listInspectorStyles.menuRow} {...reorder.row(String(index), pending)}>
                <DropIndicator marker={reorder.marker} row={String(index)} />
                {(reorder.blocked ?? reorder.rejection)?.row === String(index) && (
                  <span className={reorderStyles.reason} aria-hidden="true">
                    {(reorder.blocked ?? reorder.rejection)?.message}
                  </span>
                )}
                <IconDrag size={10} />
                <span className={listInspectorStyles.itemLabel} title={link.label}>
                  {link.label}
                </span>
                <Menu label={<IconMore size={16} />} accessibleLabel={'Actions for ' + link.label}>
                  <Button variant="tertiary" onClick={() => begin(index)}>
                    Edit link
                  </Button>
                  <Button
                    variant="tertiary"
                    disabled={pending || index === 0}
                    onClick={() => moveByKeyboard(index, index - 1)}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="tertiary"
                    disabled={pending || index === links.length - 1}
                    onClick={() => moveByKeyboard(index, index + 1)}
                  >
                    Move down
                  </Button>
                  <Button variant="tertiary" disabled={pending} onClick={() => setRemoving(index)}>
                    Remove link
                  </Button>
                </Menu>
              </li>
            ))}
          </ul>
        ) : (
          <p className={recordTableStyles.emptyRow}>No footer links yet. Add a page or website.</p>
        )}
        <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
      </Card>
    </>
  )
}

export function FooterLinkDialogs({
  model,
  navigation,
}: {
  model: FooterDraft
} & Pick<FooterWorkspaceProps, 'navigation'>) {
  const { links, value } = model
  const {
    editing,
    linkDraft,
    removing,
    setRemoving,
    query,
    setQuery,
    linkKind,
    setLinkKind,
    close,
    linkValid,
    changeLink,
  } = model.linkControls
  return (
    <>
      {editing && (
        <Dialog
          size="medium"
          density="compact"
          title={editing.fresh ? 'Add footer link' : 'Edit footer link'}
          onClose={() => close(true)}
          footer={
            <>
              <Button variant="secondary" onClick={() => close(true)}>
                Cancel
              </Button>
              <Button
                disabled={!linkValid}
                onClick={() => {
                  changeLink(linkDraft)
                  close(false)
                }}
              >
                Done
              </Button>
            </>
          }
        >
          <div className={listInspectorStyles.formStack}>
            <SegmentedControl
              label="What would you like to add?"
              appearance="pills"
              size="s"
              value={linkKind}
              onChange={setLinkKind}
              options={[
                { value: 'url', label: 'A website' },
                { value: 'page', label: 'A page on this site' },
              ]}
            />
            <Field id="footer-link-name" label="Link label" required>
              <input
                autoFocus
                maxLength={120}
                value={linkDraft.label}
                onChange={event => changeLink({ ...linkDraft, label: event.target.value })}
              />
            </Field>
            {linkKind === 'url' ? (
              <Field id="footer-link-url" label="Web address" required>
                <input
                  maxLength={2048}
                  value={linkDraft.url}
                  onChange={event => changeLink({ ...linkDraft, url: event.target.value })}
                />
              </Field>
            ) : (
              <>
                <Field id="footer-link-search" label="Find a page">
                  <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
                </Field>
                <Field id="footer-link-page" label="Page" required>
                  <select
                    value={navigation.pages.find(page => page.path === linkDraft.url)?.id ?? ''}
                    onChange={event => {
                      const page = navigation.pages.find(page => page.id === event.target.value)
                      if (page) changeLink({ label: linkDraft.label || page.title.slice(0, 120), url: page.path })
                    }}
                  >
                    <option value="">Choose a page…</option>
                    {navigation.pages
                      .filter(page => (page.title + ' ' + page.path).toLowerCase().includes(query.toLowerCase()))
                      .map(page => (
                        <option key={page.id} value={page.id}>
                          {page.title}
                          {page.published ? '' : ' · draft'}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            )}
          </div>
        </Dialog>
      )}
      {removing !== null && links && (
        <Dialog
          density="compact"
          title="Remove footer link?"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  value('links', writeFooterLinks(links.filter((_, index) => index !== removing)))
                  setRemoving(null)
                }}
              >
                Remove link
              </Button>
            </>
          }
        >
          <p>Remove “{links[removing]?.label}” from this footer draft? Its page stays available.</p>
        </Dialog>
      )}
    </>
  )
}
