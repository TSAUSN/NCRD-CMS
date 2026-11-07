import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.argv[2])
const require = createRequire(join(root, 'apps/admin/package.json'))
const { parse } = require('next/dist/compiled/babel/parser')
const { default: traverse } = require('next/dist/compiled/babel/traverse')
const src = 'apps/admin/src'
const sourceFiles = readdirSync(join(root, src), { recursive: true })
  .map(path => join(src, path))
  .sort()
const unknown = '11111111-1111-4111-a111-111111111111'
const classifier = join(root, src, 'lib/canvas-route.ts')
const canvas = existsSync(classifier)
  ? (await import(pathToFileURL(classifier))).canvasRoute
  : path => /^\/(?:pages\/[a-f0-9-]{36}|sites\/[a-f0-9-]{36}\/(?:header|footer|design(?:\/fonts)?))\/?$/i.test(path)

function symbolic(path, depth = 0) {
  if (!path?.node || depth > 8) return [unknown]
  const item = path.node
  if (item.type === 'StringLiteral') return [item.value]
  if (item.type === 'BinaryExpression' && item.operator === '+')
    return symbolic(path.get('left'), depth + 1).flatMap(left =>
      symbolic(path.get('right'), depth + 1).map(right => left + right),
    )
  if (item.type === 'TemplateLiteral') {
    return item.quasis
      .reduce(
        (prefix, part, index) => prefix + part.value.cooked + (index < item.expressions.length ? unknown : ''),
        '',
      )
      .split('\u0000')
  }
  if (item.type === 'ConditionalExpression')
    return [...symbolic(path.get('consequent'), depth + 1), ...symbolic(path.get('alternate'), depth + 1)]
  if (item.type === 'LogicalExpression')
    return [...symbolic(path.get('left'), depth + 1), ...symbolic(path.get('right'), depth + 1)]
  if (item.type === 'ObjectExpression') {
    const pathname = path
      .get('properties')
      .find(p => p.isObjectProperty() && !p.node.computed && (p.node.key.name ?? p.node.key.value) === 'pathname')
    return pathname ? symbolic(pathname.get('value'), depth + 1) : [unknown]
  }
  if (item.type === 'Identifier') {
    const binding = path.scope.getBinding(item.name)
    if (binding?.constant && binding.path.isVariableDeclarator()) return symbolic(binding.path.get('init'), depth + 1)
  }
  if (item.type === 'JSXExpressionContainer') return symbolic(path.get('expression'), depth + 1)
  if (item.type === 'TSAsExpression' || item.type === 'TSNonNullExpression' || item.type === 'TSSatisfiesExpression')
    return symbolic(path.get('expression'), depth + 1)
  return [unknown]
}

const violations = []
for (const file of sourceFiles.filter(path => path.endsWith('.tsx') && !path.endsWith('.test.tsx'))) {
  const source = readFileSync(join(root, file), 'utf8')
  if (!source.includes('next/link')) continue
  traverse(parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }), {
    JSXOpeningElement(path) {
      const { name } = path.node
      if (name.type !== 'JSXIdentifier') return
      const binding = path.scope.getBinding(name.name)
      if (binding?.path.parent?.source?.value !== 'next/link') return
      const href = path.get('attributes').find(attr => attr.isJSXAttribute() && attr.node.name.name === 'href')
      if (!href) return
      if (symbolic(href.get('value')).some(path => canvas(path.split(/[?#]/, 1)[0])))
        violations.push({ file, line: href.node.loc.start.line })
    },
  })
}
console.log(JSON.stringify(violations, null, 2))
if (violations.length) process.exitCode = 1
