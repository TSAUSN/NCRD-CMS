import 'server-only'
import { asUser } from '@cms/platform'
import { searchLabel, type SearchResult } from './command-search-model.ts'

/** Fresh RLS reads on every request, including the common-action capabilities. */
export function commandSearch(userId: string, query: string): Promise<SearchResult[]> {
  const needle = query.trim().slice(0, 120).toLowerCase()
  return asUser({ userId }, async client => {
    const pages = (
      await client.query<{ id: string; title: string; name: string }>(
        `
      SELECT p.id,p.title,s.name FROM pages p JOIN sites s ON s.id=p.site_id
      WHERE p.archived_at IS NULL AND s.archived_at IS NULL
        AND ($1='' OR position($1 in lower(p.title || ' ' || s.name))>0)
      ORDER BY lower(p.title),p.id LIMIT 12`,
        [needle],
      )
    ).rows
    const items = needle
      ? (
          await client.query<{
            id: string
            collection_id: string
            site_id: string
            name: string
            site_name: string
            label: unknown
          }>(
            `
      SELECT e.id,c.id AS collection_id,c.site_id,c.name,s.name AS site_name,
        v.values->>COALESCE(sc.sort->>'titleField',sc.fields->'presentation'->>'titleField','title') AS label
      FROM collection_entries e JOIN collections c ON c.id=e.collection_id
      JOIN sites s ON s.id=c.site_id JOIN collection_entry_versions v ON v.id=e.draft_version_id
      JOIN collection_schema_versions sc ON sc.id=c.draft_schema_version_id
      WHERE e.archived_at IS NULL AND s.archived_at IS NULL
        AND position($1 in lower(v.values::text || ' ' || c.name || ' ' || s.name))>0
      ORDER BY lower(c.name),e.sort_index,e.id LIMIT 12`,
            [needle],
          )
        ).rows
      : []
    const sites = (
      await client.query<{
        id: string
        name: string
        whole: boolean
        admin: boolean
        publish: boolean
        chapters: boolean
      }>(`
      SELECT s.id,s.name,app.has_site_access(s.id) AS whole,app.can_administer_site(s.id) AS admin,
        app.can_publish(s.id) AS publish,
        s.chapters_enabled AND (app.can_administer_site(s.id) OR EXISTS(
          SELECT 1 FROM chapter_divisions d JOIN chapter_division_memberships m ON m.division_id=d.id
          WHERE d.site_id=s.id AND m.user_id=app.current_user_id())) AS chapters
      FROM sites s WHERE s.archived_at IS NULL ORDER BY lower(s.name),s.id`)
    ).rows
    const root = (await client.query<{ root: boolean }>('SELECT app.is_super_admin() AS root')).rows[0]!.root
    const actions: SearchResult[] = [
      { id: 'home', label: 'Home', detail: 'Your workspace', href: '/', group: 'Actions' },
      { id: 'sites', label: 'All sites', detail: 'Your sites', href: '/sites', group: 'Actions' },
      { id: 'inbox', label: 'Reviews', detail: 'Inbox · reviews and requests', href: '/inbox', group: 'Actions' },
      ...(root
        ? [
            {
              id: 'people',
              label: 'People & access',
              detail: 'Manage access',
              href: '/people',
              group: 'Actions' as const,
            },
            {
              id: 'create',
              label: 'Create a site',
              detail: 'Start a new site',
              href: '/sites/new',
              group: 'Actions' as const,
            },
          ]
        : []),
    ]
    for (const site of sites) {
      for (const [area, label, allowed] of [
        ['pages', 'Pages', true],
        ['content', 'Lists', site.whole],
        ['publishing', 'Publish', site.publish],
        ['settings', 'Settings', site.admin],
        ['chapters', 'Set up chapters', site.chapters],
      ] as const) {
        if (allowed)
          actions.push({
            id: `${site.id}-${area}`,
            label,
            detail: site.name,
            href: `/sites/${site.id}/${area}`,
            group: 'Actions',
          })
      }
    }
    return [
      ...items.map(item => ({
        id: item.id,
        label: searchLabel(item.label),
        detail: `${item.name} · ${item.site_name}`,
        href: `/sites/${item.site_id}/content?collection=${item.collection_id}&entry=${item.id}`,
        group: 'List items' as const,
      })),
      ...pages.map(page => ({
        id: page.id,
        label: searchLabel(page.title, 'Untitled page'),
        detail: page.name,
        href: `/pages/${page.id}`,
        group: 'Pages' as const,
      })),
      ...actions
        .filter(action => !needle || `${action.label} ${action.detail}`.toLowerCase().includes(needle))
        .slice(0, 12),
    ]
  })
}
