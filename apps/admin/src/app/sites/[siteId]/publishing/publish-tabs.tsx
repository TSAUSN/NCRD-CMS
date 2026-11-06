'use client'
import type { ReactNode } from 'react'
import { Tabs } from '../../../../components/ui/index.ts'
import { requestClientNavigation } from '../../../../components/navigation-guard.ts'
import { useRouter } from 'next/navigation'
export function PublishTabs({
  value,
  changes,
  review,
  history,
  canReview,
  native = false,
  scheduled,
  counts,
}: {
  value: string
  changes: ReactNode
  review: ReactNode
  history: ReactNode
  canReview: boolean
  native?: boolean
  scheduled?: ReactNode
  counts?: { ready: number; scheduled: number; review: number }
}) {
  const router = useRouter()
  return (
    <Tabs
      density={native ? 'compact' : undefined}
      label="Publish"
      value={value}
      tabs={[
        {
          value: 'changes',
          label: native ? 'Ready ' + (counts?.ready ?? 0) : 'Changes ready to publish',
          accessibleLabel: 'Changes ready to publish',
        },
        ...(native
          ? [
              {
                value: 'scheduled',
                label: 'Scheduled ' + (counts?.scheduled ?? 0),
                accessibleLabel: 'Scheduled publishing',
              },
            ]
          : []),
        ...(canReview
          ? [
              {
                value: 'review',
                label: native ? 'In review ' + (counts?.review ?? 0) : 'In review',
                accessibleLabel: 'In review',
              },
            ]
          : []),
        { value: 'history', label: 'History' },
      ]}
      onChange={next => {
        const leave = () => router.push('?tab=' + next)
        if (requestClientNavigation(leave)) leave()
      }}
    >
      {value === 'review' ? review : value === 'history' ? history : value === 'scheduled' ? scheduled : changes}
    </Tabs>
  )
}
