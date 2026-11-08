import { Card, SegmentedControl } from '../../../../components/ui/index.ts'
import { CompactMenuEditor } from '../../../../components/compact-menu-editor.tsx'
import ownedStyles from './workspace-styles.module.css'
import type { HeaderMenuModel, HeaderMenuProps } from './use-header-menu.ts'
export function HeaderMenuTab({
  model,
  navigation,
}: {
  model: HeaderMenuModel
} & Pick<HeaderMenuProps, 'navigation'>) {
  const { tree, setTree, mode, setMode, pending, setItemEditing } = model
  return (
    <>
      <>
        <CompactMenuEditor
          tree={tree}
          pages={navigation.pages}
          disabled={pending}
          onChange={setTree}
          onEditing={setItemEditing}
        />
        <Card density="editor">
          <div className={ownedStyles.betweenRow}>
            <div>
              <strong>When a new page goes live</strong>
              <p className="muted">Hiding or removing a menu item never deletes its page.</p>
            </div>
            <SegmentedControl
              appearance="pills"
              label="When a new page goes live"
              value={mode}
              onChange={value => setMode(value as 'auto' | 'manual')}
              options={[
                { value: 'auto', label: 'Add it to the menu automatically', disabled: pending },
                { value: 'manual', label: 'Let me choose', disabled: pending },
              ]}
            />
          </div>
        </Card>
      </>
    </>
  )
}
