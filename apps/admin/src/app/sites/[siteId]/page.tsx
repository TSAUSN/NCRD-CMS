import { SiteWorkspace } from './site-workspace.tsx'
export const dynamic = 'force-dynamic'
export default function SiteOverview(props: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ error?: string; created?: string; siteCreated?: string }>
}) {
  return <SiteWorkspace {...props} />
}
