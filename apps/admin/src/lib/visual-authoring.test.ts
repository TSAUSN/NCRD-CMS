import { describe, expect, it } from 'vitest'
import { compileStructuredSection } from '@cms/renderer'
import { addBuilderBlock, BUILDER_CSS, newStructuredSection } from './structured-builder.ts'
import { visualSourceCss, VISUAL_BLOCK_STYLES } from './visual-authoring.ts'

describe('bounded visual styling', () => {
  it('uses fixed responsive styles for new visual sections', () => {
    expect(visualSourceCss(addBuilderBlock(newStructuredSection(), [], 'columns'))).toBe(BUILDER_CSS)
  })
  it('preserves existing authored CSS and adds only fixed missing block styles in stable order', () => {
    const initial = { ...newStructuredSection(), nodes: [] }
    const first = addBuilderBlock(addBuilderBlock(initial, [], 'columns'), [], 'image')
    const second = addBuilderBlock(addBuilderBlock(initial, [], 'image'), [], 'columns')
    const source = '.existing{background:navy}.builder-image{width:8rem}'
    const expected = `${source}\n${VISUAL_BLOCK_STYLES['builder-columns']}`
    expect(visualSourceCss(first, source)).toBe(expected)
    expect(visualSourceCss(second, source)).toBe(expected)
    const old = compileStructuredSection({ slug: 'visual', document: initial, sourceCss: source })
    const addition = compileStructuredSection({
      slug: 'visual',
      document: initial,
      sourceCss: VISUAL_BLOCK_STYLES['builder-columns'],
    })
    expect(compileStructuredSection({ slug: 'visual', document: first, sourceCss: expected }).css).toBe(
      old.css + addition.css,
    )
  })
})
