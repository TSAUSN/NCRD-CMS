// Serialized saving (SPEC §5's revision CAS, from the client side).
//
// Every mutation echoes the revision it loaded, and the server advances that
// revision on success. Two saves in flight at once therefore means the second
// one is *guaranteed* to be sending a revision the server has already moved
// past — a self-inflicted conflict that looks to the person like "someone else
// edited this page" when nobody did.
//
// So requests run one at a time, and each one is handed the revision the
// previous one returned. This is framework-independent and directly testable,
// which is why it lives here rather than as a ref inside the React component.

export type SaveRequest<T> = {
  /** What is being sent. Recorded so the caller can commit exactly this. */
  snapshot: T
  /** Runs with the revision the previous acknowledged request returned. */
  run: (revision: number, snapshot: T) => Promise<SaveOutcome>
}

export type SaveOutcome = { ok: true; revision: number } | { ok: false; conflict?: boolean }

export type QueuedResult<T> =
  | { status: 'acknowledged'; revision: number; snapshot: T }
  | { status: 'failed'; outcome: SaveOutcome }
  /** A queued request dropped because an earlier one hit a conflict. */
  | { status: 'abandoned' }

export type SaveQueue<T> = {
  /** Queue a request. Resolves once it — and everything before it — has run. */
  enqueue(request: SaveRequest<T>): Promise<QueuedResult<T>>
  /** The revision the most recent acknowledged request returned. */
  revision(): number
  /** True while a request is in flight or waiting. */
  busy(): boolean
  /** Number of requests not yet run, excluding the one in flight. */
  pending(): number
  /** After the person resolves a conflict, allow saving again. */
  reset(revision: number): void
}

export function createSaveQueue<T>(initialRevision: number): SaveQueue<T> {
  let revision = initialRevision
  let inFlight = 0
  let queued = 0
  // A conflict means the client's idea of the revision is wrong. Continuing to
  // fire queued saves would produce a cascade of identical conflicts and, worse,
  // could clobber the other person's work if one happened to succeed.
  let halted = false
  let chain: Promise<unknown> = Promise.resolve()

  return {
    revision: () => revision,
    busy: () => inFlight > 0 || queued > 0,
    pending: () => queued,
    reset(next) {
      revision = next
      halted = false
    },
    enqueue(request) {
      queued += 1
      const result = chain.then(async (): Promise<QueuedResult<T>> => {
        queued -= 1
        if (halted) return { status: 'abandoned' }

        inFlight += 1
        try {
          const outcome = await request.run(revision, request.snapshot)
          if (!outcome.ok) {
            if (outcome.conflict) halted = true
            return { status: 'failed', outcome }
          }
          // The next request in the queue uses the revision this one produced,
          // which is what keeps a burst of autosaves from conflicting with
          // itself.
          revision = outcome.revision
          return { status: 'acknowledged', revision: outcome.revision, snapshot: request.snapshot }
        } finally {
          inFlight -= 1
        }
      })

      // The chain must never reject, or one thrown error would wedge every
      // later request behind a permanently rejected promise.
      chain = result.catch(() => undefined)
      return result
    },
  }
}
