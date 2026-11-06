// A closed data grammar for V1's template declarations. This is not a JS
// interpreter: calls, computed properties, mutation and interpolation fail.
// The one known registry projection is recognized syntactically, never run.
export type Literal = null | boolean | number | string | Literal[] | { [key: string]: Literal }
type Token = { kind: 'word' | 'string' | 'number' | 'symbol'; value: string; line: number }
export type LiteralTemplate = { value: Record<string, Literal>; line: number }
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/
function tokens(source: string): Token[] {
  if (Buffer.byteLength(source) > 8 * 1024 * 1024) throw new Error('template module exceeds 8 MiB')
  const result: Token[] = []
  let at = 0,
    line = 1
  const fail = () => {
    throw new Error(`unsupported literal module syntax at line ${line}`)
  }
  while (at < source.length) {
    if (result.length > 200_000) throw new Error('template module contains too many tokens')
    const char = source[at]!
    if (/\s/.test(char)) {
      if (char === '\n') line++
      at++
      continue
    }
    if (source.startsWith('//', at)) {
      const end = source.indexOf('\n', at + 2)
      at = end < 0 ? source.length : end
      continue
    }
    if (source.startsWith('/*', at)) {
      const end = source.indexOf('*/', at + 2)
      if (end < 0) fail()
      line += source.slice(at, end + 2).split('\n').length - 1
      at = end + 2
      continue
    }
    const startLine = line
    if (['"', "'", '`'].includes(char)) {
      const quote = char
      let value = ''
      let closed = false
      at++
      while (at < source.length) {
        const current = source[at++]!
        if (current === quote) {
          closed = true
          break
        }
        if (quote === '`' && current === '$' && source[at] === '{') fail()
        if (current === '\n') {
          if (quote !== '`') fail()
          line++
        }
        if (current !== '\\') {
          value += current
          continue
        }
        const escaped = source[at++]
        const simple: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          v: '\v',
          '\\': '\\',
          '"': '"',
          "'": "'",
          '`': '`',
        }
        if (escaped && Object.hasOwn(simple, escaped)) value += simple[escaped]
        else if (escaped === '0' && !/[0-9]/.test(source[at] ?? '')) value += '\0'
        else if (escaped === '\n') line++
        else if (escaped === 'u' || escaped === 'x') {
          const size = escaped === 'u' ? 4 : 2,
            hex = source.slice(at, at + size)
          if (!new RegExp(`^[0-9a-fA-F]{${size}}$`).test(hex)) fail()
          value += String.fromCharCode(Number.parseInt(hex, 16))
          at += size
        } else fail()
      }
      if (!closed) fail()
      result.push({ kind: 'string', value, line: startLine })
      continue
    }
    const word = identifier.exec(source.slice(at))
    if (word) {
      result.push({ kind: 'word', value: word[0], line })
      at += word[0].length
      continue
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/.exec(source.slice(at))
    if (number) {
      result.push({ kind: 'number', value: number[0], line })
      at += number[0].length
      continue
    }
    const symbol = ['...', '===', '=>', '??'].find(value => source.startsWith(value, at)) ?? char
    if (!['...', '===', '=>', '??', '{', '}', '[', ']', '(', ')', '=', ':', ',', ';', '.'].includes(symbol)) fail()
    result.push({ kind: 'symbol', value: symbol, line })
    at += symbol.length
    if (result.length > 200_000) throw new Error('template module contains too many tokens')
  }
  return result
}
const object = (value: Literal): value is Record<string, Literal> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function readLiteralTemplateModule(source: string): LiteralTemplate[] {
  const input = tokens(source)
  let index = 0
  const bindings = new Map<string, { value: Literal; line: number }>()
  const imports = new Set<string>()
  const exported: LiteralTemplate[] = []
  const objectLines = new WeakMap<object, number>()
  const peek = () => input[index]?.value
  const take = () => {
    const token = input[index++]
    if (!token) throw new Error('unexpected end of literal module')
    return token
  }
  const expect = (value: string) => {
    const token = take()
    if (token.value !== value) throw new Error(`expected ${value} at line ${token.line}`)
    return token
  }
  const word = () => {
    const token = take()
    if (token.kind !== 'word') throw new Error(`expected identifier at line ${token.line}`)
    return token.value
  }
  function literal(depth = 0): Literal {
    if (depth > 24) throw new Error('literal module nesting exceeds 24 levels')
    const token = take()
    if (token.kind === 'string') return token.value
    if (token.kind === 'number') return Number(token.value)
    if (token.value === 'true') return true
    if (token.value === 'false') return false
    if (token.value === 'null') return null
    if (token.value === '{') {
      const value: Record<string, Literal> = Object.create(null)
      objectLines.set(value, token.line)
      while (peek() !== '}') {
        const key = take()
        if (
          !['word', 'string'].includes(key.kind) ||
          ['__proto__', 'constructor', 'prototype'].includes(key.value) ||
          Object.hasOwn(value, key.value)
        )
          throw new Error(`unsupported or repeated property at line ${key.line}`)
        expect(':')
        value[key.value] = literal(depth + 1)
        if (peek() !== ',') break
        take()
      }
      expect('}')
      return value
    }
    if (token.value === '[') {
      const value: Literal[] = []
      while (peek() !== ']') {
        if (value.length >= 1000) throw new Error('literal module array exceeds 1000 entries')
        value.push(literal(depth + 1))
        if (peek() !== ',') break
        take()
      }
      expect(']')
      return value
    }
    throw new Error(`unsupported literal value at line ${token.line}`)
  }
  function add(value: Literal, line: number) {
    if (
      !object(value) ||
      typeof value.id !== 'string' ||
      typeof value.html !== 'string' ||
      typeof value.css !== 'string' ||
      !Array.isArray(value.slots)
    )
      throw new Error(`invalid template declaration at line ${line}`)
    exported.push({ value, line: objectLines.get(value) ?? line })
  }
  while (index < input.length) {
    if (peek() === ';') {
      take()
      continue
    }
    if (peek() === 'import') {
      take()
      expect('{')
      do {
        const name = word()
        if (imports.has(name) || bindings.has(name)) throw new Error('duplicate module binding')
        imports.add(name)
        if (peek() !== ',') break
        take()
      } while (true)
      expect('}')
      expect('from')
      const file = take()
      if (file.kind !== 'string' || !/^\.\/[a-z][a-z-]*\.js$/.test(file.value))
        throw new Error('unsupported template module import')
      continue
    }
    const isExport = peek() === 'export'
    if (isExport) take()
    if (isExport && peek() === 'function') {
      // Known convenience lookup is not evaluated or exposed to the importer.
      take()
      expect('getGitSectionTemplate')
      expect('(')
      expect('templateId')
      expect(')')
      expect('{')
      expect('return')
      expect('gitSectionTemplates')
      expect('.')
      expect('find')
      expect('(')
      expect('template')
      expect('=>')
      expect('template')
      expect('.')
      expect('id')
      expect('===')
      expect('templateId')
      expect(')')
      expect('??')
      expect('null')
      if (peek() === ';') take()
      expect('}')
      continue
    }
    expect('const')
    const name = word()
    expect('=')
    if (bindings.has(name) || imports.has(name)) throw new Error('duplicate module binding')
    if (isExport && name === 'gitSectionTemplates') {
      expect('[')
      while (peek() !== ']') {
        const spread = peek() === '...'
        if (spread) take()
        const reference = word(),
          binding = bindings.get(reference)
        if (binding) {
          if (spread) throw new Error('unsupported local registry spread')
          add(binding.value, binding.line)
        } else if (!spread || !imports.has(reference)) throw new Error('unknown registry template binding')
        if (peek() === '.') {
          // Source-owned HNI extraction adds only an explicit site identity.
          if (reference !== 'hniExtractedSectionTemplates') throw new Error('unsupported registry projection')
          for (const value of [
            '.',
            'map',
            '(',
            'template',
            '=>',
            '(',
            '{',
            '...',
            'template',
            ',',
            'sites',
            ':',
            '[',
            'humanneedsindex',
            ']',
            '}',
            ')',
            ')',
          ])
            expect(value)
        }
        if (peek() !== ',') break
        take()
      }
      expect(']')
      bindings.set(name, { value: [], line: 0 })
      continue
    }
    const line = input[index]?.line ?? 0,
      value = literal()
    bindings.set(name, { value, line })
    if (isExport) {
      if (name !== 'librarySectionTemplates' || !Array.isArray(value))
        throw new Error('unsupported template module export')
      for (const template of value) add(template, line)
    }
  }
  if (!exported.length) throw new Error('template module exports no literal definitions')
  if (new Set(exported.map(item => item.value.id)).size !== exported.length)
    throw new Error('duplicate template identity in module')
  return exported
}
