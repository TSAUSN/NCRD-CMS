'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
/** Older bookmarks still reach the same authorized administrative work. */
export function LegacyReviewLink({ active, selected }: { active: string; selected: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (active !== 'pages' || selected) return
    const hash = window.location.hash
    if (hash === '#custom-requests' || hash === '#operational-issues')
      router.replace('/inbox?area=advanced' + (hash === '#operational-issues' ? '&task=background' : '') + hash)
  }, [active, selected, router])
  return null
}
