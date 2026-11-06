import { describe, expect, it } from 'vitest'
import { readLiteralTemplateModule } from './literal-module.ts'
const value = `{id:'sample-v1',html:'<section>sample</section>',css:'.sample{}',slots:[]}`
const library = (body: string) => `export const librarySectionTemplates = [${body}]`
describe('closed source-module data reader', () => {
  it('reads exact literals and per-object source lines without executing a module', () => {
    const rows = readLiteralTemplateModule(
      `// source\n${library(`\n${value},\n${value.replace('sample-v1', 'second-v1')}`)}`,
    )
    expect(rows.map(row => row.line)).toEqual([3, 4])
    expect(rows[0]!.value.html).toBe('<section>sample</section>')
  })
  it('decodes explicit string escapes and preserves multiline template bytes', () => {
    const row = readLiteralTemplateModule(
      library("{id:'sample-v1',html:`line\n\\u0041\\x42\\n\\``,css:'a\\t',slots:[]}"),
    )[0]!
    expect(row.value.html).toBe('line\nAB\n`')
    expect(row.value.css).toBe('a\t')
  })
  it('selects only named exported local templates, with an inert known imported spread', () => {
    const rows = readLiteralTemplateModule(
      `import { librarySectionTemplates } from './library-sections.js'; const unused = ${value}; const selected = ${value.replace('sample-v1', 'selected-v1')}; export const gitSectionTemplates = [selected,...librarySectionTemplates];`,
    )
    expect(rows.map(row => row.value.id)).toEqual(['selected-v1'])
  })
  it.each([
    `${library(value)}; globalThis.executed = true`,
    library(value.replace("'<section>sample</section>'", 'makeHtml()')),
    library(value.replace("'<section>sample</section>'", '`hello ${run()}`')),
    library(value.replace("'<section>sample</section>'", "'a' + 'b'")),
    library(value.replace('slots:[]', 'slots:[], get surprise(){return 1}')),
    library(value.replace('slots:[]', 'slots:[], __proto__:{}')),
    library(value.replace('slots:[]', 'slots:[], slots:[]')),
    library(`${value},${value}`),
    `import { data } from 'network-module'; ${library(value)}`,
    `const template = ${value}; export const gitSectionTemplates = [...template]`,
    `const template = ${value}; export const gitSectionTemplates = [template.map(run)]`,
  ])('refuses unfamiliar or executable syntax %#', source => {
    expect(() => readLiteralTemplateModule(source)).toThrow()
    expect((globalThis as Record<string, unknown>).executed).toBeUndefined()
  })
})
