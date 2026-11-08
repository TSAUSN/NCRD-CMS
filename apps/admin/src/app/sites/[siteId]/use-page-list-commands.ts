import { useEffect, useRef, useState } from 'react'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import type { PageListControls } from '../../../lib/page-list-workspace.ts'
import { changePageList } from './page-list-actions.ts'
import { movePageInOrder } from './page-order.ts'

export function usePageListCommands(siteId: string, initial: PageListControls | null) {
  const [controls, setControls] = useState(initial)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const busy = useRef(false)
  useEffect(() => setControls(initial), [initial])
  useNavigationGuard(() => ({ dirty: false, pending: pending || busy.current }))
  async function save(
    pageId: string,
    kind: 'menu' | 'footer' | 'move',
    options: { on?: boolean; beforeId?: string; afterId?: string } = {},
  ) {
    if (!controls || busy.current) return
    busy.current = true
    setPending(true)
    setNotice('')
    setError('')
    const before = controls
    if (kind === 'move') {
      const order = movePageInOrder(before.order, pageId, options)
      if (order) setControls({ ...before, order })
    }
    try {
      const result = await changePageList({ siteId, pageId, kind, ...options, controls })
      if (result.ok) {
        setControls(result.controls)
        setNotice(result.message)
      } else {
        if (kind === 'move') setControls(before)
        setError(result.message)
      }
    } catch {
      if (kind === 'move') setControls(before)
      setError('The save could not be confirmed. Reload to compare before trying again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return { controls, pending, notice, error, save }
}
