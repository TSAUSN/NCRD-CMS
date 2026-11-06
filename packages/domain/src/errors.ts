// One vocabulary of failure for every publishing path (SPEC §6.8). The
// database raises custom SQLSTATEs; this maps them once so no surface has to
// match on message text, and so a new caller cannot invent its own taxonomy.

export type DomainErrorKind =
  | 'stale_revision'
  | 'not_authorized'
  | 'not_found'
  | 'invalid_state'
  | 'trusted_code_unapproved'

const BY_SQLSTATE: Record<string, DomainErrorKind> = {
  CMS01: 'stale_revision',
  CMS02: 'not_authorized',
  CMS03: 'not_found',
  CMS04: 'invalid_state',
  CMS05: 'trusted_code_unapproved',
  // A grant or policy refusal is an authorization failure wherever it happens.
  '42501': 'not_authorized',
}

export class DomainError extends Error {
  readonly kind: DomainErrorKind
  /** For `stale_revision`, the revision the head actually holds. */
  readonly currentRevision: number | undefined

  constructor(kind: DomainErrorKind, message: string, currentRevision?: number) {
    super(message)
    this.name = 'DomainError'
    this.kind = kind
    this.currentRevision = currentRevision
  }
}

type SqlError = { code?: string; message?: string; detail?: string }

function revisionFromDetail(detail: string | undefined): number | undefined {
  if (!detail) return undefined
  const plain = Number(detail)
  if (Number.isFinite(plain)) return plain
  try {
    const parsed = JSON.parse(detail) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    for (const key of ['revision', 'entry_revision']) {
      const candidate = Number(record[key])
      if (Number.isFinite(candidate)) return candidate
    }
  } catch {
    // DETAIL is diagnostic text. A non-JSON value simply carries no numeric
    // revision; the typed stale-revision failure itself is still preserved.
  }
  return undefined
}

/** Turn a Postgres error into a domain error, or return null if it is not one. */
export function fromSqlError(error: unknown): DomainError | null {
  const sql = error as SqlError
  const kind = sql?.code ? BY_SQLSTATE[sql.code] : undefined
  if (!kind) return null
  const current = kind === 'stale_revision' ? revisionFromDetail(sql.detail) : undefined
  return new DomainError(kind, sql.message ?? kind, current)
}

/** Wrap a database call so callers only ever see domain errors. */
export async function mapErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw fromSqlError(error) ?? error
  }
}
