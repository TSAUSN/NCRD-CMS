'use client'
import { useRouter } from 'next/navigation'
import { IconPlus } from '../../../../components/icons.tsx'
import { Button } from '../../../../components/ui/index.ts'
import type { StoriesSettings } from '@cms/schema'
import type { MediaAsset } from '../../../../lib/media-library.ts'
/** All Stories hubs enter the same empty writing screen; navigation writes nothing. */
export function AddStory({
  siteId,
}: {
  siteId: string
  collectionId: string
  revision: string
  media: MediaAsset[]
  catalog: StoriesSettings
}) {
  const router = useRouter()
  return (
    <Button onClick={() => router.push('/sites/' + siteId + '/stories/new')}>
      <IconPlus size={14} />
      Add story
    </Button>
  )
}
