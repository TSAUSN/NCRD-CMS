import { useEffect } from 'react'
import type { PageEditorProps } from './editor-types.ts'

/** Reveal the field named by the link after its details panel is rendered. */
export function useEditorInitialField(
  props: Pick<PageEditorProps, 'initialField' | 'initialFocus' | 'initialSection'>,
) {
  useEffect(() => {
    const field = props.initialFocus
    if (!field) return
    const target =
      field === 'picture-description' && typeof props.initialSection === 'number' && props.initialField
        ? `slot-${props.initialSection}-${props.initialField}-alt`
        : ['title', 'description', 'canonical'].includes(field)
          ? `meta-${field}`
          : null
    if (!target) return
    let observer: ResizeObserver | undefined
    let settle: ReturnType<typeof setTimeout> | undefined
    const focus = () => {
      const element = document.getElementById(target)
      if (!element) return
      for (let parent = element.parentElement; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true
      const reveal = () => element.scrollIntoView({ block: 'center' })
      element.focus({ preventScroll: true })
      reveal()
      // Page details load after the search fields. Keep the requested field
      // visible while that form settles, then return scrolling to the author.
      const container = element.closest('dialog') ?? element.closest('aside')
      if (container) {
        observer = new ResizeObserver(reveal)
        for (const section of container.querySelectorAll('section,details')) observer.observe(section)
        settle = setTimeout(() => observer?.disconnect(), 2000)
      }
    }
    const timer = setTimeout(focus, 0)
    return () => {
      clearTimeout(timer)
      if (settle) clearTimeout(settle)
      observer?.disconnect()
    }
  }, [props.initialField, props.initialFocus, props.initialSection])
}
