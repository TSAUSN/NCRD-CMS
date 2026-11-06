// The autosave acknowledgement race, made deterministic.
//
// Every test here drives the exact interleaving by hand — a deferred promise the
// test resolves when it chooses — rather than by sleeping and hoping. A timing
// test that passes because a timer happened to win is not evidence.
import { describe, expect, it, vi } from 'vitest'
import { commitSaved, createEditorState, isDirty, setValue, type EditorDocument } from './editing.ts'
import { createSaveQueue, type SaveOutcome } from './save-queue.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

const doc = (heading: string): EditorDocument => ({
  sections: [{ section_def_id: 'hero', section_def_version: 1, values: { heading } }],
  meta: {},
})

describe('commitSaved records what the server acknowledged, not what is on screen', () => {
  it('leaves text typed during the request dirty', () => {
    // Type A, start saving A, type B before the response arrives.
    let state = createEditorState(doc('start'))
    state = setValue(state, 0, 'heading', 'A')
    const acknowledged = state.document // this is what the request carries

    state = setValue(state, 0, 'heading', 'B') // typed while in flight
    state = commitSaved(state, acknowledged) // the response for A lands

    // B never reached the server, so it must still look unsaved — otherwise
    // no further autosave fires and B is lost on refresh.
    expect(isDirty(state)).toBe(true)
    expect(state.saved.sections[0]!.values['heading']).toBe('A')
    expect(state.document.sections[0]!.values['heading']).toBe('B')
  })

  it('is clean when nothing was typed during the request', () => {
    let state = createEditorState(doc('start'))
    state = setValue(state, 0, 'heading', 'A')
    state = commitSaved(state, state.document)
    expect(isDirty(state)).toBe(false)
  })

  it('the follow-up save then acknowledges B and settles clean', () => {
    let state = createEditorState(doc('start'))
    state = setValue(state, 0, 'heading', 'A')
    const first = state.document
    state = setValue(state, 0, 'heading', 'B')
    state = commitSaved(state, first)
    expect(isDirty(state)).toBe(true)

    state = commitSaved(state, state.document) // the second save lands
    expect(isDirty(state)).toBe(false)
    expect(state.saved.sections[0]!.values['heading']).toBe('B')
  })
})

describe('the save queue serializes requests', () => {
  it('never runs two requests at once', async () => {
    const queue = createSaveQueue<string>(1)
    const gates = [deferred<SaveOutcome>(), deferred<SaveOutcome>()]
    let concurrent = 0
    let maxConcurrent = 0

    const run = (index: number) => async (): Promise<SaveOutcome> => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      const outcome = await gates[index]!.promise
      concurrent -= 1
      return outcome
    }

    const a = queue.enqueue({ snapshot: 'A', run: run(0) })
    const b = queue.enqueue({ snapshot: 'B', run: run(1) })

    gates[0]!.resolve({ ok: true, revision: 2 })
    await a
    gates[1]!.resolve({ ok: true, revision: 3 })
    await b

    expect(maxConcurrent).toBe(1)
  })

  it('hands each request the revision the previous one returned', async () => {
    const queue = createSaveQueue<string>(5)
    const seen: number[] = []
    const record = async (revision: number): Promise<SaveOutcome> => {
      seen.push(revision)
      return { ok: true, revision: revision + 1 }
    }

    await Promise.all([
      queue.enqueue({ snapshot: 'A', run: record }),
      queue.enqueue({ snapshot: 'B', run: record }),
      queue.enqueue({ snapshot: 'C', run: record }),
    ])

    // Without serialization all three would have sent revision 5 and two of
    // them would have come back as conflicts.
    expect(seen).toEqual([5, 6, 7])
    expect(queue.revision()).toBe(8)
  })

  it('resolves in order, never out of order', async () => {
    const queue = createSaveQueue<string>(1)
    const gates = [deferred<SaveOutcome>(), deferred<SaveOutcome>()]
    const finished: string[] = []

    const a = queue.enqueue({ snapshot: 'A', run: () => gates[0]!.promise }).then(() => finished.push('A'))
    const b = queue.enqueue({ snapshot: 'B', run: () => gates[1]!.promise }).then(() => finished.push('B'))

    // Resolve the SECOND request's gate first. It must still not finish first,
    // because it has not been started yet.
    gates[1]!.resolve({ ok: true, revision: 3 })
    await vi.waitFor(() => expect(finished).toEqual([]))

    gates[0]!.resolve({ ok: true, revision: 2 })
    await Promise.all([a, b])
    expect(finished).toEqual(['A', 'B'])
  })

  it('reports the snapshot each request carried, so the caller commits the right one', async () => {
    const queue = createSaveQueue<string>(1)
    const result = await queue.enqueue({
      snapshot: 'the acknowledged text',
      run: async () => ({ ok: true, revision: 2 }),
    })
    expect(result).toEqual({ status: 'acknowledged', revision: 2, snapshot: 'the acknowledged text' })
  })
})

describe('a conflict stops the queue rather than cascading', () => {
  it('abandons queued requests after a conflict', async () => {
    const queue = createSaveQueue<string>(1)
    const gate = deferred<SaveOutcome>()
    let secondRan = false

    const first = queue.enqueue({ snapshot: 'A', run: () => gate.promise })
    const second = queue.enqueue({
      snapshot: 'B',
      run: async () => {
        secondRan = true
        return { ok: true, revision: 9 }
      },
    })

    gate.resolve({ ok: false, conflict: true })
    expect(await first).toEqual({ status: 'failed', outcome: { ok: false, conflict: true } })
    expect(await second).toEqual({ status: 'abandoned' })
    // Firing it would have produced a second identical conflict at best, and at
    // worst overwritten the other person's work.
    expect(secondRan).toBe(false)
  })

  it('resumes after the person resolves the conflict', async () => {
    const queue = createSaveQueue<string>(1)
    await queue.enqueue({ snapshot: 'A', run: async () => ({ ok: false, conflict: true }) })
    queue.reset(7)

    const after = await queue.enqueue({
      snapshot: 'B',
      run: async revision => ({ ok: true, revision: revision + 1 }),
    })
    expect(after).toEqual({ status: 'acknowledged', revision: 8, snapshot: 'B' })
  })

  it('an ordinary failure does not halt the queue — only a conflict does', async () => {
    const queue = createSaveQueue<string>(1)
    await queue.enqueue({ snapshot: 'A', run: async () => ({ ok: false }) })
    const after = await queue.enqueue({
      snapshot: 'B',
      run: async revision => ({ ok: true, revision: revision + 1 }),
    })
    expect(after.status).toBe('acknowledged')
  })

  it('a thrown request does not wedge everything behind it', async () => {
    const queue = createSaveQueue<string>(1)
    const boom = queue.enqueue({
      snapshot: 'A',
      run: async () => {
        throw new Error('network died')
      },
    })
    await expect(boom).rejects.toThrow('network died')

    const after = await queue.enqueue({
      snapshot: 'B',
      run: async revision => ({ ok: true, revision: revision + 1 }),
    })
    expect(after.status).toBe('acknowledged')
  })
})

describe('publishing while an autosave is in flight', () => {
  it('waits its turn and publishes the revision the autosave produced', async () => {
    const queue = createSaveQueue<string>(4)
    const autosaveGate = deferred<SaveOutcome>()
    const order: string[] = []

    const autosave = queue.enqueue({
      snapshot: 'latest text',
      run: async () => {
        order.push('autosave')
        return autosaveGate.promise
      },
    })

    let publishRevision = -1
    const publish = queue.enqueue({
      snapshot: 'latest text',
      run: async revision => {
        order.push('publish')
        publishRevision = revision
        return { ok: true, revision: revision + 1 }
      },
    })

    expect(queue.busy()).toBe(true)
    autosaveGate.resolve({ ok: true, revision: 5 })
    await Promise.all([autosave, publish])

    expect(order).toEqual(['autosave', 'publish'])
    // The publish used the revision the autosave produced, so it cannot
    // conflict with it and cannot publish a stale snapshot.
    expect(publishRevision).toBe(5)
    expect(queue.busy()).toBe(false)
  })

  it('does not publish at all if the autosave ahead of it conflicted', async () => {
    const queue = createSaveQueue<string>(1)
    let published = false
    const autosave = queue.enqueue({ snapshot: 'x', run: async () => ({ ok: false, conflict: true }) })
    const publish = queue.enqueue({
      snapshot: 'x',
      run: async () => {
        published = true
        return { ok: true, revision: 2 }
      },
    })

    await Promise.all([autosave, publish])
    expect(published).toBe(false)
  })
})
