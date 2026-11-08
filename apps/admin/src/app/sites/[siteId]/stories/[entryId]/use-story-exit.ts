import { useEffect, useRef, useState, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'

export function useStoryExit({
  storiesPath,
  dirty,
  pending,
  inFlight,
}: {
  storiesPath: string
  dirty: boolean
  pending: boolean
  inFlight: RefObject<boolean>
}) {
  const router = useRouter()
  const [leaveOpen, setLeaveOpen] = useState(false)
  const leaveDestination = useRef<(() => void) | null>(null)
  const finishLeave = () => {
    const proceed = leaveDestination.current
    leaveDestination.current = null
    setLeaveOpen(false)
    if (proceed) proceed()
    else router.push(storiesPath)
  }
  const cancelLeave = () => {
    leaveDestination.current = null
    setLeaveOpen(false)
  }
  useNavigationGuard(() => ({
    dirty,
    pending: pending || inFlight.current,
    requestLeave: proceed => {
      if (!leaveOpen) {
        leaveDestination.current = proceed
        setLeaveOpen(true)
      }
    },
  }))
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || pending) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, pending])
  const back = () => {
    if (pending || inFlight.current) return
    if (dirty) {
      leaveDestination.current = null
      setLeaveOpen(true)
    } else router.push(storiesPath)
  }
  return { leaveOpen, finishLeave, cancelLeave, back }
}
