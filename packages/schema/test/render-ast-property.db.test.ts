// `app.render_ast_defect` has one property, and it is not a list of cases.
//
// The gate answers a question with two possible answers: here is what is wrong
// with this AST, or nothing is wrong with it. A third answer leaked in and was
// treated as the second one for four migrations — NULL, which means "no
// answer". CMS-DB-01 was exactly that: `jsonb_typeof(node -> 'value')` is NULL
// when the key is missing, `NULL <> 'string'` is NULL rather than true, so the
// guard did not fire; `markup || NULL` then made the accumulator NULL, and
// `markup ~* '<\s*script[\s/>]'` evaluated to NULL and the one rule keeping a
// data slot out of a script-bearing template was silently skipped for the rest
// of the node list. An AST prefixed with `{"kind":"html"}` carried a script
// element and editable slots past the gate.
//
// Case-by-case tests would not have caught it, because every individual case
// looked plausible. So this states the property instead: for anything that is
// not a fully-shaped AST, the answer is a sentence. It is driven from a table
// so the next reader adds a case in one line, and so that a case which passes
// for the wrong reason is visible — the expectation names the sentence, not
// just its existence.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase } from './harness.ts'

let db: TestDatabase
beforeAll(async () => {
  db = await TestDatabase.create('astproperty')
})
afterAll(async () => {
  await db?.close()
})

const CURRENT_POLICY = 4

async function defect(ast: unknown, policyVersion: number | null = CURRENT_POLICY): Promise<string | null> {
  return db.as('owner', async client => {
    const { rows } = await client.query<{ d: string | null }>('SELECT app.render_ast_defect($1::jsonb, $2) AS d', [
      ast === undefined ? null : JSON.stringify(ast),
      policyVersion,
    ])
    return rows[0]!.d
  })
}

const HTML = { kind: 'html', value: '<section>' }
const SLOT = { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' }
const CLOSE = { kind: 'html', value: '</section>' }

/** A compiled section exactly as the compiler emits one. */
const WHOLE = { nodes: [HTML, SLOT, CLOSE], policyVersion: 4, cssPolicyVersion: 6 }

/**
 * Every case, and what the gate must say about it.
 *
 * A string expectation is a fragment the sentence has to contain — enough to
 * prove the gate refused this AST for the reason under test, rather than
 * tripping over something incidental on the way. `null` means the AST really is
 * fully shaped and accepting it is the right answer, which is only three rows
 * and every one of them is deliberate.
 */
const CASES: readonly [label: string, ast: unknown, expected: string | null][] = [
  ['a compiled section', WHOLE, null],

  // Missing and JSON-null are different spellings of the same absence, and
  // jsonb tells them apart while `->>` does not. Both are listed for every key,
  // because the COALESCE that fixes one does not always cover the other.
  ['a node with no kind', { ...WHOLE, nodes: [{ value: 'x' }] }, 'unknown kind null'],
  ['a node whose kind is JSON null', { ...WHOLE, nodes: [{ kind: null, value: 'x' }] }, 'unknown kind null'],
  ['a node whose kind is not one of the two', { ...WHOLE, nodes: [{ kind: 'wat' }] }, 'unknown kind wat'],

  ['markup with no value', { ...WHOLE, nodes: [{ kind: 'html' }] }, 'node 0 is markup with no value'],
  [
    'markup whose value is JSON null',
    { ...WHOLE, nodes: [{ kind: 'html', value: null }] },
    'node 0 is markup with no value',
  ],
  [
    'markup whose value is a number',
    { ...WHOLE, nodes: [{ kind: 'html', value: 7 }] },
    'node 0 is markup with no value',
  ],
  [
    'markup whose value is an object',
    { ...WHOLE, nodes: [{ kind: 'html', value: { toString: 'x' } }] },
    'node 0 is markup with no value',
  ],

  [
    'a slot with no id',
    { ...WHOLE, nodes: [{ kind: 'slot', slotKind: 'text', context: 'element-text' }] },
    'slot id that is not a usable one: null',
  ],
  [
    'a slot whose id is JSON null',
    { ...WHOLE, nodes: [{ kind: 'slot', slotId: null, slotKind: 'text', context: 'element-text' }] },
    'slot id that is not a usable one: null',
  ],

  [
    'a slot with no kind',
    { ...WHOLE, nodes: [{ kind: 'slot', slotId: 'value', context: 'element-text' }] },
    'which is not a slot kind',
  ],
  [
    'a slot whose kind is JSON null',
    { ...WHOLE, nodes: [{ kind: 'slot', slotId: 'value', slotKind: null, context: 'element-text' }] },
    'which is not a slot kind',
  ],

  [
    'a slot with no context',
    { ...WHOLE, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'text' }] },
    'does not say what kind of place it sits in',
  ],
  [
    'a slot whose context is JSON null',
    { ...WHOLE, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'text', context: null }] },
    'does not say what kind of place it sits in',
  ],

  ['an AST with no node list', { policyVersion: 4, cssPolicyVersion: 6 }, 'has no node list'],
  ['an AST whose node list is JSON null', { nodes: null, policyVersion: 4 }, 'has no node list'],
  ['an AST whose node list is an object', { nodes: { 0: SLOT }, policyVersion: 4 }, 'has no node list'],
  ['an AST whose node list is a string', { nodes: '[]', policyVersion: 4 }, 'has no node list'],

  ['a node that is a number', { ...WHOLE, nodes: [42] }, 'node 0 is not an object'],
  ['a node that is JSON null', { ...WHOLE, nodes: [null] }, 'node 0 is not an object'],
  ['a node that is an array', { ...WHOLE, nodes: [[]] }, 'node 0 is not an object'],

  ['an AST that is an array rather than an object', [WHOLE], 'is not a compiled section'],
  ['an AST that is a string', 'nope', 'is not a compiled section'],
  ['an AST that is a number', 7, 'is not a compiled section'],
  ['an AST that is JSON null', null, 'is not a compiled section'],

  // The walk has to keep walking. A node list whose first entries are correct
  // is the shape that made CMS-DB-01 survive review: everything up to the
  // malformed entry reads exactly like a compiled section.
  [
    'a node list mixing valid and malformed entries',
    { ...WHOLE, nodes: [HTML, SLOT, { kind: 'html' }] },
    'node 2 is markup with no value',
  ],
  [
    'a malformed node after a slot and a script fragment',
    { ...WHOLE, nodes: [HTML, SLOT, { kind: 'html', value: '<script>x</script>' }, { kind: 'html' }] },
    'node 3 is markup with no value',
  ],

  // CMS-DB-01 itself. The leading valueless html node is the whole exploit: it
  // used to poison the markup accumulator, and the script-and-slots rule at the
  // end was then skipped rather than failed.
  [
    'the CMS-DB-01 reproduction: a valueless html node, a script, and a slot',
    {
      nodes: [
        { kind: 'html' },
        { kind: 'html', value: '<script>globalThis.__pwned=1</script><p>' },
        SLOT,
        { kind: 'html', value: '</p>' },
      ],
      policyVersion: 4,
      cssPolicyVersion: 6,
    },
    'node 0 is markup with no value',
  ],
  [
    'a script element and a slot in well-formed nodes',
    {
      nodes: [{ kind: 'html', value: '<script>x</script><p>' }, SLOT, { kind: 'html', value: '</p>' }],
      policyVersion: 4,
      cssPolicyVersion: 6,
    },
    'mixes a script element with editable slots',
  ],

  // An empty node list is not malformed. A definition can legitimately compile
  // to nothing — an author who deleted the template — and the gate's job is to
  // say what is wrong, not to have an opinion about emptiness.
  ['an empty node list', { nodes: [], policyVersion: 4, cssPolicyVersion: 6 }, null],
]

describe('the gate either names a defect or vouches for the whole AST', () => {
  it.each(CASES)('%s', async (label, ast, expected) => {
    const found = await defect(ast)
    if (expected === null) {
      expect(found, `the gate refused an AST this suite holds to be well formed (${label})`).toBeNull()
      return
    }
    // The property, stated before the specific expectation, because a NULL here
    // is a different and much worse failure than a wrong sentence: it means the
    // gate stopped checking rather than that it disagreed.
    expect(
      found,
      `app.render_ast_defect returned NULL for ${label}. NULL means "no answer" and the callers ` +
        'read it as "nothing is wrong" — this is the CMS-DB-01 shape, where a three-valued ' +
        'comparison disabled every check downstream of it.',
    ).not.toBeNull()
    expect(found).toContain(expected)
  })

  it('never answers with an empty sentence', async () => {
    // A zero-length defect is NULL's quieter cousin: `defect IS NOT NULL` is
    // true, the caller raises an exception whose message trails off, and the
    // author is told nothing.
    for (const [label, ast, expected] of CASES) {
      if (expected === null) continue
      expect((await defect(ast))?.length ?? 0, label).toBeGreaterThan(0)
    }
  })
})

describe('the policy version is an argument, not a claim the AST makes', () => {
  it('refuses an AST whose stored version is below the current policy', async () => {
    expect(await defect(WHOLE, 3)).toContain('requires version 4')
  })

  it('refuses an AST whose stored version is unknown', async () => {
    expect(await defect(WHOLE, null)).toContain('sanitizer policy version null')
  })

  // Was documented here as a finding rather than fixed, and then fixed in
  // migration 0020. The gate checked the `sanitizer_policy_version` *column*
  // and never `p_ast -> 'policyVersion'`, so a stored row could disagree with
  // itself: the database saw nothing wrong, the renderer read the artifact's
  // own field, refused to trust it, and the section rendered as nothing. A
  // definition accepted everywhere and visible nowhere — the CMS-DB-07 shape.
  it('refuses an AST whose own policyVersion disagrees with its column', async () => {
    expect(await defect({ ...WHOLE, policyVersion: 1 }, CURRENT_POLICY)).toContain(
      'says it was compiled under sanitizer policy version 1',
    )
  })

  it('refuses an AST that does not say which policy compiled it', async () => {
    expect(await defect({ ...WHOLE, policyVersion: null }, CURRENT_POLICY)).toContain(
      'does not say which sanitizer policy version compiled it',
    )
    expect(await defect({ nodes: WHOLE.nodes, cssPolicyVersion: 6 }, CURRENT_POLICY)).toContain(
      'does not say which sanitizer policy version compiled it',
    )
  })
})
