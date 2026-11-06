'use client'

import { useState, type ReactNode } from 'react'
import type { StructuredDocument, StructuredNode } from '@cms/schema'
import {
  addBuilderBlock,
  childrenOf,
  moveBuilderNode,
  removeBuilderNode,
  type BuilderBlock,
} from '../lib/structured-builder.ts'

const LABELS: Record<BuilderBlock, string> = {
  heading: 'Heading',
  text: 'Formatted text',
  image: 'Image',
  link: 'Link or button',
  icon: 'Icon',
  group: 'Group',
  columns: 'Two columns',
}
const CONTAINERS = new Set(['section', 'div', 'article', 'header', 'footer', 'main', 'aside', 'li'])
const ELEMENT_NAMES: Record<string, string> = {
  section: 'Section container',
  div: 'Group',
  article: 'Content card',
  header: 'Header group',
  footer: 'Footer group',
  main: 'Main content',
  aside: 'Supporting content',
  h1: 'Page heading',
  h2: 'Heading',
  h3: 'Subheading',
  h4: 'Small heading',
  p: 'Paragraph',
  ul: 'Bulleted list',
  ol: 'Numbered list',
  li: 'List item',
  span: 'Inline text',
  a: 'Link',
  blockquote: 'Quote',
}

export function StructuredBuilder({
  document,
  onChange,
  disabled = false,
}: {
  document: StructuredDocument
  onChange: (next: StructuredDocument) => void
  disabled?: boolean
}) {
  const [notice, setNotice] = useState<string | null>(null)
  function add(parent: number[], kind: BuilderBlock) {
    if (document.fields.length >= 100 || parent.length >= 12) {
      setNotice('This section is at the visual builder’s size limit. Split it into smaller sections.')
      return
    }
    onChange(addBuilderBlock(document, parent, kind))
    setNotice(null)
  }
  function addControls(parent: number[]) {
    return (
      <div className="builder-add" role="group" aria-label="Add a block">
        {(Object.keys(LABELS) as BuilderBlock[]).map(kind => (
          <button
            key={kind}
            type="button"
            className="secondary small"
            disabled={disabled}
            onClick={() => add(parent, kind)}
          >
            + {LABELS[kind]}
          </button>
        ))}
      </div>
    )
  }
  function nodeRow(node: StructuredNode, path: number[], siblings: number, inRepeat = false): ReactNode {
    const field =
      node.type === 'element' || node.type === 'provider-embed'
        ? null
        : document.fields.find(candidate => candidate.name === node.field)
    const title =
      node.type === 'element'
        ? node.tag === 'div' && node.attributes?.['class'] === 'builder-columns'
          ? 'Two columns'
          : (ELEMENT_NAMES[node.tag] ?? 'Container')
        : node.type === 'provider-embed'
          ? `Tableau chart: ${node.title}`
          : node.type === 'repeat'
            ? `Collection list: ${field?.label || node.field}`
            : field?.label || node.field
    const children = childrenOf(node)
    return (
      <li key={path.join('-')} className="builder-node">
        <div className="builder-node-head">
          <strong>{title}</strong>
          <span className="builder-node-actions">
            <button
              type="button"
              className="secondary small"
              disabled={disabled || path.at(-1) === 0}
              aria-label={`Move ${title} up`}
              onClick={() => onChange(moveBuilderNode(document, path, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="secondary small"
              disabled={disabled || path.at(-1) === siblings - 1}
              aria-label={`Move ${title} down`}
              onClick={() => onChange(moveBuilderNode(document, path, 1))}
            >
              ↓
            </button>
            <button
              type="button"
              className="danger small"
              disabled={disabled}
              aria-label={`Remove ${title}`}
              onClick={() => onChange(removeBuilderNode(document, path))}
            >
              Remove
            </button>
          </span>
        </div>
        {field && !inRepeat && (
          <div className="field">
            <label htmlFor={`builder-label-${path.join('-')}`}>Field label</label>
            <input
              id={`builder-label-${path.join('-')}`}
              disabled={disabled}
              value={field.label}
              maxLength={256}
              onChange={event =>
                onChange({
                  ...document,
                  fields: document.fields.map(item =>
                    item.name === field.name ? { ...item, label: event.target.value } : item,
                  ),
                })
              }
            />
            <p className="hint">
              {field.type} · {field.name}
            </p>
          </div>
        )}
        {node.type === 'provider-embed' && (
          <p className="hint">
            Approved Tableau view: {node.view}. Visitors choose whether to load the chart; its provider address cannot
            be changed through page fields.
          </p>
        )}
        {node.type === 'icon' && (
          <p className="hint">Editors choose a decorative symbol from the icon library on each page.</p>
        )}
        {node.type === 'repeat' && (
          <p className="hint">The collection is chosen on each page. Its record fields are managed in Collections.</p>
        )}
        {children.length > 0 && (
          <ol>
            {children.map((child, index) =>
              nodeRow(child, [...path, index], children.length, inRepeat || node.type === 'repeat'),
            )}
          </ol>
        )}
        {node.type === 'element' && CONTAINERS.has(node.tag) && !inRepeat && addControls(path)}
      </li>
    )
  }
  return (
    <div className="structured-builder">
      <p>Build a section from editable blocks. Two-column groups stack automatically on phones.</p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <ol>{document.nodes.map((node, index) => nodeRow(node, [index], document.nodes.length))}</ol>
      {addControls([])}
    </div>
  )
}
