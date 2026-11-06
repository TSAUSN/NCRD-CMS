const HISTORY_COLUMNS = `
  pv.id,
  pv.revision::text AS revision,
  pv.kind::text AS kind,
  pv.note,
  pv.created_at,
  pv.author_id = app.current_user_id() AS authored_by_me,
  pv.id = p.draft_version_id AS is_current_draft,
  pv.id = p.published_version_id AS is_live_now,
  operations.was_published IS TRUE AS was_published,
  operations.was_restored IS TRUE AS was_restored
`

const HISTORY_FROM = `
  FROM page_versions pv
  JOIN pages p ON p.id = pv.page_id
  LEFT JOIN (
    SELECT after_ref AS version_id,
           bool_or(action = 'page.publish') AS was_published,
           bool_or(action = 'page.restore') AS was_restored
      FROM audit_log
     WHERE action IN ('page.publish', 'page.restore')
       AND item_type = 'page'
       AND item_id = $1
       AND after_ref IS NOT NULL
     GROUP BY after_ref
  ) operations ON operations.version_id = pv.id
`

/** Newest-first page history, with routine autosaves hidden unless requested. */
export const PAGE_HISTORY_SQL = `
  SELECT ${HISTORY_COLUMNS}
  ${HISTORY_FROM}
   WHERE pv.page_id = $1
     AND ($2::boolean
       OR pv.kind <> 'autosave'::version_kind
       OR pv.id = p.draft_version_id
       OR pv.id = p.published_version_id
       OR operations.was_published IS TRUE)
     AND ($3::bigint IS NULL OR pv.revision < $3::bigint)
   ORDER BY pv.revision DESC
   LIMIT $4
`

/** One version for the detail pane, still scoped to the requested page. */
export const PAGE_HISTORY_VERSION_SQL = `
  SELECT ${HISTORY_COLUMNS}
  ${HISTORY_FROM}
   WHERE pv.page_id = $1 AND pv.id = $2
`
