import type { NavTree } from '@cms/schema'
import { siteInitials } from '../../../../lib/site-initials.ts'
import { IconEye } from '../../../../components/icons.tsx'

export function NavigationPreview({ siteName, tree }: { siteName: string; tree: NavTree }) {
  const initials = siteInitials(siteName)
  const visible = tree.filter(node => node.visible)
  return (
    <aside className="navigation-preview" aria-labelledby="navigation-preview-title">
      <div className="navigation-preview-head">
        <div>
          <p className="eyebrow">Draft preview</p>
          <h2 id="navigation-preview-title">Preview</h2>
        </div>
        <span>
          <IconEye size={14} /> Header
        </span>
      </div>
      <div className="navigation-preview-browser">
        <div className="navigation-preview-brand">
          <span aria-hidden="true">{initials}</span>
          <strong>{siteName}</strong>
        </div>
        <nav aria-label="Preview of the draft navigation">
          {visible.length === 0 ? (
            <p>No visible menu items</p>
          ) : (
            <ul>
              {visible.map((node, index) => (
                <li key={`${node.label}-${index}`}>
                  <span>{node.label}</span>
                  {node.children?.some(child => child.visible) && (
                    <ul>
                      {node.children
                        .filter(child => child.visible)
                        .map((child, childIndex) => (
                          <li key={`${child.label}-${childIndex}`}>{child.label}</li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </nav>
      </div>
      <p className="navigation-preview-note">
        This shows the order and visibility of your current draft. Check the published header for the site's layout.
      </p>
    </aside>
  )
}
