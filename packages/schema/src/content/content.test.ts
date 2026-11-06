import { describe, expect, it } from 'vitest'
import { NavTree, PageContent, SectionInstance, SlotDef, ThemeTokens } from './index.ts'

describe('SectionInstance', () => {
  it('fills defaults for a minimal instance', () => {
    const parsed = SectionInstance.parse({
      section_def_id: 'def-1',
      section_def_version: 3,
    })
    expect(parsed.values).toEqual({})
    expect(parsed.hidden).toBe(false)
    expect(parsed.hidden_at).toEqual([])
  })

  it('rejects unknown breakpoints in hidden_at', () => {
    const result = SectionInstance.safeParse({
      section_def_id: 'def-1',
      section_def_version: 1,
      hidden_at: ['xl'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a def version below 1 — versions are 1-based and pinned', () => {
    const result = SectionInstance.safeParse({
      section_def_id: 'def-1',
      section_def_version: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('PageContent', () => {
  it('is an ordered list of section instances', () => {
    const parsed = PageContent.parse([
      { section_def_id: 'a', section_def_version: 1 },
      { section_def_id: 'b', section_def_version: 2, hidden: true },
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[1]?.hidden).toBe(true)
  })
})

describe('SlotDef', () => {
  it('rejects a slot kind the renderer does not know', () => {
    const result = SlotDef.safeParse({ id: 'x', kind: 'video', label: 'X' })
    expect(result.success).toBe(false)
  })
})

describe('NavTree', () => {
  it('parses nested nodes with page and url targets', () => {
    const parsed = NavTree.parse([
      {
        label: 'About',
        target: { type: 'page', page_id: '00000000-0000-4000-8000-000000000001' },
        visible: true,
        children: [{ label: 'Team', target: { type: 'url', url: '/team' }, visible: false }],
      },
    ])
    expect(parsed[0]?.children?.[0]?.visible).toBe(false)
  })

  it('refuses deeper nesting, unsafe URLs and unbounded labels', () => {
    expect(
      NavTree.safeParse([
        {
          label: 'Parent',
          visible: true,
          target: { type: 'url', url: '/parent' },
          children: [
            {
              label: 'Child',
              visible: true,
              target: { type: 'url', url: '/child' },
              children: [{ label: 'Too deep', visible: true, target: { type: 'url', url: '/deep' } }],
            },
          ],
        },
      ]).success,
    ).toBe(false)
    expect(
      NavTree.safeParse([
        {
          label: 'Unsafe',
          visible: true,
          target: { type: 'url', url: 'javascript:alert(1)' },
        },
      ]).success,
    ).toBe(false)
    expect(
      NavTree.safeParse([
        {
          label: 'x'.repeat(81),
          visible: true,
          target: { type: 'url', url: '/okay' },
        },
      ]).success,
    ).toBe(false)
  })
})

describe('ThemeTokens', () => {
  it('requires heading and body font stacks', () => {
    const result = ThemeTokens.safeParse({ colors: { primary: '#003087' }, fonts: { heading: 'Georgia, serif' } })
    expect(result.success).toBe(false)
  })

  it('normalises an old bounded theme without rewriting its stored version', () => {
    const parsed = ThemeTokens.parse({
      colors: { primary: '#003087', surface: '#ffffff', ink: '#1a1a1a' },
      fonts: { heading: "Georgia, 'Times New Roman', serif", body: 'system-ui, sans-serif' },
      radius: '0.5rem',
    })
    expect(parsed.colors.accent).toBe('#d22630')
    expect(parsed.buttons.hover).toBe('darken')
    expect(parsed.spacing).toBe('comfortable')
  })

  it('refuses CSS, unknown controls, and ungoverned font stacks', () => {
    const base = {
      colors: { primary: '#003087', surface: '#ffffff', ink: '#1a1a1a' },
      fonts: { heading: "Georgia, 'Times New Roman', serif", body: 'system-ui, sans-serif' },
    }
    expect(ThemeTokens.safeParse({ ...base, radius: '0.5rem;display:none' }).success).toBe(false)
    expect(ThemeTokens.safeParse({ ...base, mystery: true }).success).toBe(false)
    expect(ThemeTokens.safeParse({ ...base, fonts: { ...base.fonts, body: 'Comic Sans MS' } }).success).toBe(false)
  })
})
