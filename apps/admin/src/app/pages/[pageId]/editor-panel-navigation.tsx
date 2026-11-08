'use client'
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../components/ui/button.tsx'
import { IconChevronLeft } from '../../../components/icons.tsx'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
type Navigation = { target: HTMLDivElement | null; register: (id: string, active: boolean) => void }
const Context = createContext<Navigation | null>(null)
/** A fixed place for section or nested item controls, without a second set of buttons. */
export function EditorPanelNavigation({
  enabled = true,
  onBack,
  onDone,
  children,
}: {
  enabled?: boolean
  onBack: () => void
  onDone: () => void
  children: ReactNode
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [nested, setNested] = useState<Set<string>>(() => new Set())
  const register = useCallback(
    (id: string, active: boolean) =>
      setNested(current => {
        if (current.has(id) === active) return current
        const next = new Set(current)
        if (active) next.add(id)
        else next.delete(id)
        return next
      }),
    [],
  )
  const context = useMemo(() => ({ target, register }), [target, register])
  if (!enabled) return children
  return (
    <Context.Provider value={context}>
      <div className={workspaceFormsStyles.panelActions} ref={setTarget} data-editor-panel-navigation>
        {!nested.size && (
          <>
            <Button variant="tertiary" onClick={onBack}>
              <IconChevronLeft size={16} />
              Back
            </Button>
            <Button onClick={onDone}>Done</Button>
          </>
        )}
      </div>
      {children}
    </Context.Provider>
  )
}
/** Nested controls retain their own handlers, validation and cancel semantics. */
export function EditorPanelActions({ children }: { children: ReactNode }) {
  const navigation = useContext(Context)
  const id = useId()
  const register = navigation?.register
  useLayoutEffect(() => {
    register?.(id, true)
    return () => register?.(id, false)
  }, [id, register])
  return navigation ? (
    navigation.target ? (
      createPortal(children, navigation.target)
    ) : null
  ) : (
    <div className={workspaceFormsStyles.panelActions}>{children}</div>
  )
}
