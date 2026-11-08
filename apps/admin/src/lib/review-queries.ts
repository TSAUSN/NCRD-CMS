import { resolvedDataSections } from './data-values.ts'
import 'server-only'
import { storyReviewPresentation } from './story-review.ts'
import type { ReleasePresentation } from './release-copy.ts'
import { asUser } from '@cms/platform'
import { summarizePageReview, type EditorSection, type ReviewChangeSummary, type ReviewStatus } from '@cms/domain'

type ReviewQueueRow = {
  submission_id: string
  site_id: string
  site_name: string
  page_id: string
  page_title: string
  page_slug: string
  version_id: string
  version_revision: string
  status: ReviewStatus
  request_note: string
  decision_note: string
  submitted_by: string
  submitted_by_name: string
  decided_by_name: string | null
  submitted_at: Date
  decided_at: Date | null
  page_revision: string
  current_draft_version_id: string | null
  published_version_id: string | null
  submitted_content: unknown
  submitted_meta: Record<string, unknown>
  live_content: unknown | null
  live_meta: Record<string, unknown> | null
  carries_trusted_code: boolean
  trusted_code_approved_by: string | null
  can_review: boolean
  can_approve: boolean
  comment_count: number
  unresolved_comment_count: number
}

export type ReviewSubmission = {
  story?: ReleasePresentation
  storyEntryId?: string
  id: string
  siteId: string
  siteName: string
  pageId: string
  pageTitle: string
  pagePath: string
  versionId: string
  versionRevision: number
  status: ReviewStatus
  requestNote: string
  decisionNote: string
  submittedBy: string
  submittedByName: string
  decidedByName: string | null
  submittedAt: string
  decidedAt: string | null
  pageRevision: number
  currentDraftVersionId: string | null
  publishedVersionId: string | null
  isCurrent: boolean
  carriesTrustedCode: boolean
  trustedCodeApproved: boolean
  canReview: boolean
  canApprove: boolean
  commentCount: number
  unresolvedCommentCount: number
  summary: ReviewChangeSummary
}

export type ReviewComment = {
  id: string
  body: string
  mentions: string[]
  authorId: string
  authorName: string
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolvedByName: string | null
  canResolve: boolean
}

export type ReviewPerson = { id: string; displayName: string }

function sections(value: unknown): EditorSection[] {
  return Array.isArray(value) ? (value as EditorSection[]) : []
}

function mapSubmission(row: ReviewQueueRow): ReviewSubmission {
  return {
    id: row.submission_id,
    siteId: row.site_id,
    siteName: row.site_name,
    pageId: row.page_id,
    pageTitle: row.page_title,
    pagePath: row.page_slug ? `/${row.page_slug}` : '/',
    versionId: row.version_id,
    versionRevision: Number(row.version_revision),
    status: row.status,
    requestNote: row.request_note,
    decisionNote: row.decision_note,
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
    decidedByName: row.decided_by_name,
    submittedAt: row.submitted_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    pageRevision: Number(row.page_revision),
    currentDraftVersionId: row.current_draft_version_id,
    publishedVersionId: row.published_version_id,
    isCurrent: row.current_draft_version_id === row.version_id,
    carriesTrustedCode: row.carries_trusted_code,
    trustedCodeApproved: row.trusted_code_approved_by !== null,
    canReview: row.can_review,
    canApprove: row.can_approve,
    commentCount: row.comment_count,
    unresolvedCommentCount: row.unresolved_comment_count,
    summary: summarizePageReview({
      submittedSections: sections(row.submitted_content),
      submittedMeta: row.submitted_meta ?? {},
      liveSections: row.live_content === null ? null : sections(row.live_content),
      liveMeta: row.live_meta,
    }),
  }
}

/** The cross-site owner inbox, or one site's publishing queue. */
export function listReviewSubmissions(
  userId: string,
  options?: {
    siteId?: string | null
    includeDecided?: boolean
    limit?: number
    submissionId?: string | null
    pageId?: string | null
  },
): Promise<ReviewSubmission[]> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<ReviewQueueRow>(
      'SELECT * FROM app.review_queue($1::uuid,$2::boolean,$3::integer,$4::uuid,$5::uuid)',
      [
        options?.siteId ?? null,
        options?.includeDecided ?? true,
        options?.limit ?? 100,
        options?.submissionId ?? null,
        options?.pageId ?? null,
      ],
    )
    const result = rows.map(mapSubmission)
    if (result.length) {
      const pins = (
        await client.query(
          `SELECT pin.submission_id,pin.entry_id,pin.live_values,v.values,s.fields,s.sort AS settings FROM story_review_pins pin JOIN collection_entry_versions v ON v.id=pin.entry_version_id JOIN collection_schema_versions s ON s.id=pin.schema_version_id WHERE pin.submission_id=ANY($1::uuid[])`,
          [result.map(row => row.id)],
        )
      ).rows
      for (const pin of pins) {
        const item = result.find(row => row.id === pin.submission_id)
        if (item) {
          item.story = storyReviewPresentation(pin.live_values, pin.values, pin.fields, pin.settings)
          item.storyEntryId = pin.entry_id
        }
      }
    }
    return result
  })
}

export async function getReviewSubmission(userId: string, submissionId: string): Promise<ReviewSubmission | null> {
  const rows = await listReviewSubmissions(userId, {
    includeDecided: true,
    limit: 1,
    submissionId,
  })
  return rows[0] ?? null
}

export function listPageReviewSubmissions(userId: string, pageId: string): Promise<ReviewSubmission[]> {
  return listReviewSubmissions(userId, { includeDecided: true, limit: 100, pageId })
}

export function listReviewComments(userId: string, submissionId: string): Promise<ReviewComment[]> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{
      id: string
      body: string
      mentions: unknown
      author_id: string
      author_name: string
      created_at: Date
      resolved_at: Date | null
      resolved_by: string | null
      resolved_by_name: string | null
      can_resolve: boolean
    }>('SELECT * FROM app.review_comments($1)', [submissionId])
    return rows.map(row => ({
      id: row.id,
      body: row.body,
      mentions: Array.isArray(row.mentions)
        ? row.mentions.filter((value): value is string => typeof value === 'string')
        : [],
      authorId: row.author_id,
      authorName: row.author_name,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      resolvedBy: row.resolved_by,
      resolvedByName: row.resolved_by_name,
      canResolve: row.can_resolve,
    }))
  })
}

export function listReviewPeople(userId: string, siteId: string): Promise<ReviewPerson[]> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{ id: string; display_name: string }>('SELECT * FROM app.review_people($1)', [
      siteId,
    ])
    return rows.map(row => ({ id: row.id, displayName: row.display_name }))
  })
}

/** The selected request uses the same plain-word comparison as Publish. */
export function reviewChangePresentation(userId: string, submissionId: string): Promise<ReleasePresentation | null> {
  return asUser({ userId }, async client => {
    const row = (
      await client.query<ReviewQueueRow>('SELECT * FROM app.review_queue(NULL,true,1,$1,NULL)', [submissionId])
    ).rows[0]
    if (!row) return null
    const versions = [row.version_id, ...(row.published_version_id ? [row.published_version_id] : [])]
    const manifests = (
      await client.query<{
        id: string
        manifest: {
          page: { title: string; path: string }
          sections: {
            def: { section_def_id: string; version: number; slots: import('@cms/schema').SlotDef[] }
            instance: { label?: string }
          }[]
        }
      }>('SELECT id,app.build_initial_preview_manifest(id) manifest FROM page_versions WHERE id=ANY($1::uuid[])', [
        versions,
      ])
    ).rows
    const forms = Object.fromEntries(
      manifests.flatMap(({ manifest }) =>
        manifest.sections.map(section => [
          section.def.section_def_id + ':' + section.def.version,
          { name: section.instance.label || 'Section', slots: section.def.slots },
        ]),
      ),
    )
    const { pageChangePresentation } = await import('./release-copy.ts')
    const submitted = manifests.find(item => item.id === row.version_id)?.manifest.page
    const live = manifests.find(item => item.id === row.published_version_id)?.manifest.page
    const settings = (
      await client.query(
        'SELECT v.settings FROM site_settings h JOIN site_setting_versions v ON v.id=h.published_version_id WHERE h.site_id=$1',
        [row.site_id],
      )
    ).rows[0]?.settings
    return pageChangePresentation(
      row.live_content === null ? null : resolvedDataSections(sections(row.live_content), forms, settings),
      resolvedDataSections(sections(row.submitted_content), forms, settings),
      forms,
      row.live_content === null
        ? null
        : {
            title: live?.title ?? row.page_title,
            address: live?.path.slice(1) ?? row.page_slug,
            description: row.live_meta?.description ?? '',
          },
      {
        title: submitted?.title ?? row.page_title,
        address: submitted?.path.slice(1) ?? row.page_slug,
        description: row.submitted_meta.description ?? '',
      },
    )
  })
}
