import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Base64, sha256Hex } from './sha256.ts'

describe('dependency-free SHA-256', () => {
  it('matches Node byte for byte across lengths, block boundaries and non-ASCII text', () => {
    const samples = [
      '',
      'abc',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(65),
      'a'.repeat(1000),
      'Café – “quoted” — 日本語 🙂',
      '\u0000￿',
      JSON.stringify({ ast: { nodes: [1, 2, 3] }, css: '.x{color:red}' }),
    ]
    for (let i = 0; i < 200; i++) samples.push(randomBytes(i * 7).toString('latin1'))
    for (const text of samples) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'))
      expect(sha256Base64(text)).toBe(createHash('sha256').update(text, 'utf8').digest('base64'))
    }
  })
  it('gives the standard test vectors', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
