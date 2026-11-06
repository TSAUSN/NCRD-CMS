import { describe, expect, it } from 'vitest'
import { CMS_ICONS, ICON_PRESENTATION } from '@cms/schema'
import { renderCmsIcon } from './icons.ts'
import { compileStructuredSection, renderStructuredBody } from './structured.ts'
import { compileSection } from './compile.ts'
import { renderSection } from './render.ts'

describe('closed editable icons', () => {
  it('only emits code-owned decorative SVG for known names', () => {
    for (const name of Object.keys(CMS_ICONS)) expect(renderCmsIcon(name)).toContain('aria-hidden="true"')
    for (const value of ['', null, {}, '__proto__', '<svg onload="alert(1)">', 'https://other.test/icon.svg'])
      expect(renderCmsIcon(value)).toBe('')
  })
  it('binds a structured icon to a text field and refuses extra markup or mismatched fields', () => {
    const document = {
      schemaVersion: 3,
      fields: [{ name: 'symbol', type: 'text', label: 'Icon' }],
      nodes: [{ type: 'icon', field: 'symbol' }],
    }
    const compiled = compileStructuredSection({ slug: 'icon-test', document, sourceCss: '' })
    expect(compiled.blocking).toEqual([])
    const def = { definition_kind: 'structured', structured_schema_version: 3, structured_doc: compiled.document }
    expect(renderStructuredBody(def, { symbol: 'heart' })).toBe(renderCmsIcon('heart'))
    expect(renderStructuredBody(def, { symbol: '<img src=x onerror=bad>' })).toBe('')
    expect(
      compileStructuredSection({
        slug: 'bad-icon',
        sourceCss: '',
        document: { ...document, nodes: [{ type: 'icon', field: 'symbol', svg: '<svg/>' }] },
      }).blocking.length,
    ).toBeGreaterThan(0)
    expect(
      compileStructuredSection({
        slug: 'bad-icon',
        sourceCss: '',
        document: { ...document, fields: [{ name: 'symbol', type: 'image', label: 'Icon' }] },
      }).blocking.length,
    ).toBeGreaterThan(0)
  })
  it('retains the legacy wrapper and uses an icon selection rather than a text caret', () => {
    const slots = [
      { id: 'symbol', kind: 'text' as const, label: 'Icon', constraints: { presentation: ICON_PRESENTATION } },
    ]
    const compiled = compileSection({ sourceHtml: '<span class="round-icon">{{symbol}}</span>', slots })
    const section = {
      def: { section_def_id: 'icons', version: 1, compiled_ast: compiled.ast, slots },
      instance: { section_def_id: 'icons', section_def_version: 1, values: { symbol: 'info' } },
    }
    expect(renderSection(section, 0)).toContain(`<span class="round-icon">${renderCmsIcon('info')}</span>`)
    expect(renderSection(section, 0, { preview: true })).toContain('data-cms-kind="icon"')
  })
})
