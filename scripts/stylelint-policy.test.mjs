import { test } from 'node:test'
import assert from 'node:assert/strict'
import stylelint from 'stylelint'
import config from '../stylelint.config.mjs'
test('new UI styles reject raw colours and pixel values; tokens remain accepted', async () => {
  for (const code of [
    '.card { color: rebeccapurple; }',
    '.card { color: #fff; }',
    '.card { color: rgb(0, 0, 0); }',
    '.card { padding: 12px; }',
    '.card { border: 1px solid red; }',
  ]) {
    const result = await stylelint.lint({ code, codeFilename: 'apps/admin/src/components/ui/check.module.css', config })
    assert.equal(result.errored, true, code)
  }
  const result = await stylelint.lint({
    code: '.card { color: var(--text); padding: var(--space-4); border: var(--line-thin) solid var(--border); }',
    codeFilename: 'apps/admin/src/components/ui/check.module.css',
    config,
  })
  assert.equal(result.errored, false)
})
