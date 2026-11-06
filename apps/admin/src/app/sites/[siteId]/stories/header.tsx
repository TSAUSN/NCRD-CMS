import type { ReactNode } from 'react'
import { PageHeader } from '../../../../components/ui/index.ts'
export function StoriesHeader({
  siteId,
  live,
  needsReview,
  view,
  actions,
  sourceStatus,
}: {
  siteId: string
  live: number
  needsReview: number
  view: 'stories' | 'overview' | 'world' | 'split' | 'order' | 'soon'
  actions: ReactNode
  sourceStatus?: string
}) {
  return (
    <PageHeader
      density="compact"
      showWayfinding={false}
      title="Stories"
      tabsLabel="Story views"
      tabs={[
        { href: '/sites/' + siteId + '/stories', label: 'Stories', current: view === 'stories' },
        { href: '/sites/' + siteId + '/stories?view=gaps', label: 'Overview', current: view === 'overview' },
        { href: '/sites/' + siteId + '/stories?view=world', label: 'World View', current: view === 'world' },
        { href: '/sites/' + siteId + '/stories?view=split', label: 'Split View', current: view === 'split' },
        { href: '/sites/' + siteId + '/stories?view=order', label: 'Newsroom order', current: view === 'order' },
        { href: '/sites/' + siteId + '/stories?view=soon', label: 'Coming up', current: view === 'soon' },
      ]}
      lede={`${live} live · ${needsReview} need review${sourceStatus ? ' · ' + sourceStatus : ''}`}
      sub="These tags decide which pages show each story."
      stacked
      actions={actions}
    />
  )
}
