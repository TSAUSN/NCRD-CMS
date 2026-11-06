import { describe, expect, it } from 'vitest'
import { referenceCssClosure } from './reference-css-closure.ts'

describe('reference stylesheet dependency closure', () => {
  it('keeps escaped utility classes, root tokens and media rules while removing unrelated sections', () => {
    const result = referenceCssClosure(
      '<div class="v1-reference-root"><p class="text-white md:grid">Source</p></div>',
      '.v1-reference-root{--ink:white}.text-white{color:var(--ink)}@media(min-width:768px){.md\\:grid{display:grid}.absent{color:red}}.other-section{padding:8rem}',
    )
    expect(result.css).toContain('--ink:white')
    expect(result.css).toContain('.text-white')
    expect(result.css).toContain('@media(min-width:768px)')
    expect(result.css).toContain('.md\\:grid')
    expect(result.css).not.toContain('.absent')
    expect(result.css).not.toContain('.other-section')
    expect(result.retainedRules).toBe(3)
    expect(result.retainedBytes).toBeLessThan(result.sourceBytes)
  })
  it('preserves negative selectors, alternative branches, native state and animation dependencies', () => {
    const result = referenceCssClosure(
      '<details class="card"><summary>Open</summary><p>Text</p></details>',
      '.card:not(.disabled){color:blue}.card:is(.missing,.card){padding:1rem}details[open] p{color:red}.card:hover{animation:fade 1s}@keyframes fade{from{opacity:0}to{opacity:1}}',
    )
    expect(result.css).toContain(':not(.disabled)')
    expect(result.css).toContain(':is(.missing,.card)')
    expect(result.css).toContain('details[open] p')
    expect(result.css).toContain('.card:hover')
    expect(result.css).toContain('@keyframes fade{from{opacity:0}to{opacity:1}}')
  })
  it('does not prune when character references make the inventory uncertain', () => {
    const result = referenceCssClosure('<div class="a&#x3a;b">Text</div>', '.a\\:b{color:red}.unrelated{padding:1rem}')
    expect(result.retainedRules).toBe(2)
  })
  it('retains variable values without interpreting apparent selectors in strings', () => {
    const result = referenceCssClosure(
      '<div class="v1-reference-root"><p>Source</p></div>',
      '.v1-reference-root{--url:url("/images/body.png");--label:".absent"}p::before{content:var(--label)}',
    )
    expect(result.css).toContain('/images/body.png')
    expect(result.css).toContain('".absent"')
    expect(result.retainedRules).toBe(2)
  })
})
