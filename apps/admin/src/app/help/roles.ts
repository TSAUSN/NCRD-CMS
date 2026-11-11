import type { Audience, HelpTopic } from './content.ts'

export const helpRoles = {
  all: {
    label: 'Everyone',
    summary: 'Choose your role for the tasks you can usually perform.',
    tasks: ['cms-map', 'roles', 'missing-access'],
  },
  super: {
    label: 'Super admin',
    summary:
      'Manage the CMS across sites: people, assignments and new websites. Cloud project permissions are separate.',
    tasks: ['add-person', 'site-access', 'new-site', 'publish'],
  },
  admin: {
    label: 'Admin',
    summary:
      'Manage an assigned website, its shared design and publishing. Ask a Super admin to add people or create a website.',
    tasks: ['content-work', 'publish', 'fonts', 'scoped-access'],
  },
  editor: {
    label: 'Site editor',
    summary:
      'Edit and publish content within your assigned sites or pages. Shared site design and People management belong to administrators.',
    tasks: ['content-work', 'publish', 'stories', 'missing-access'],
  },
  creator: {
    label: 'Content creator',
    summary: 'Prepare drafts and submit them for approval. Your approver handles publication.',
    tasks: ['content-work', 'stories', 'saved-numbers', 'missing-access'],
  },
  scoped: {
    label: 'Chapter or division team',
    summary:
      'Work on assigned chapter pages or your division’s chapters. Chapter contributors submit; division teams have their existing approval workflow.',
    tasks: ['scoped-access', 'missing-access', 'publish'],
  },
  operator: {
    label: 'Hosting and maintenance',
    summary:
      'Maintain deployment, identity providers and addresses using your separately approved infrastructure access.',
    tasks: ['domains', 'deployment', 'microsoft', 'cms-map'],
  },
} as const
export type HelpRole = keyof typeof helpRoles
export const audienceNames: Record<Audience, string> = {
  all: 'Everyone',
  super: 'Super admins',
  admin: 'Site administration',
  editor: 'Content editing',
  scoped: 'Chapter and division access',
  operator: 'Hosting and maintenance',
}
export function suggestedHelpRole(role: string): HelpRole {
  const label = role.toLowerCase()
  if (label.includes('super admin')) return 'super'
  if (label.includes('division') || label.includes('assigned pages')) return 'scoped'
  if (label === 'admin') return 'admin'
  if (label.includes('creator')) return 'creator'
  if (label.includes('editor')) return 'editor'
  return 'all'
}
export function helpForRole(topic: HelpTopic, role: HelpRole): boolean {
  if (role === 'all' || role === 'super' || topic.audience === 'all') return true
  if (role === 'admin') return ['admin', 'editor', 'scoped'].includes(topic.audience)
  if (role === 'editor' || role === 'creator') return topic.audience === 'editor'
  if (role === 'scoped') return topic.audience === 'scoped' || ['publish', 'saved-numbers'].includes(topic.id)
  return topic.audience === 'operator'
}
const searchFillers = new Set(['how', 'do', 'i', 'a', 'an', 'the', 'to', 'can', 'my', 'is', 'what', 'for'])
function searchWords(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => !searchFillers.has(word))
    .map(word =>
      word.endsWith('ies')
        ? word.slice(0, -3) + 'y'
        : word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
          ? word.slice(0, -1)
          : word,
    )
}
export function searchHelp(topic: HelpTopic, query: string): boolean {
  const words = searchWords(query)
  const text = new Set(
    searchWords(
      [topic.title, ...topic.text, ...(topic.steps ?? []), topic.keywords ?? '', audienceNames[topic.audience]].join(
        ' ',
      ),
    ),
  )
  return words.every(word => text.has(word))
}
