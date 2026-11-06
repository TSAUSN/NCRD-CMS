// A page's search and social metadata (SPEC §6.8).
//
// WHERE THE CANONICAL POLICY IS, AND WHY IT IS NOT HERE
//
// `canonical` is the one field on this object that can reassign the page's
// identity: a canonical link tells every search engine which address *is* this
// document, so an absolute URL naming another host asks the whole index to
// credit that host with this page's content. The rule that stops it — same-site
// only, https only, compared against the site's *verified* `canonical_host` —
// lives in `packages/renderer/src/canonical.ts`, and deliberately not here.
//
// This schema validates one page's content in isolation. It is not given the
// site, so it does not know which host is verified, and "is this URL our own?"
// is entirely a question about that. A second, weaker copy of the rule written
// against what this file *can* see would be the more permissive of the two, and
// the permissive one is the one an attacker gets to choose — the same shape of
// mistake as an oracle copied from the thing it checks.
//
// So the constraints below are the ones that are true without knowing the site,
// and the renderer refuses everything else at render time, on every publish
// path, replacing a refused value with the page's own address rather than
// publishing it.
import { z } from 'zod'

/**
 * Longer than any address a browser or crawler will honour, and short enough
 * that this cannot become a way to put a megabyte into every page's `<head>`.
 * The 1 MiB whole-content cap in migration 0001 is the only other bound on this
 * field, and one megabyte of `<link rel="canonical">` is not a canonical link.
 */
const MAX_CANONICAL_LENGTH = 2048

/**
 * Bounds on the two free-text fields. Neither is a security limit — both are
 * escaped at every sink — but both are emitted into every page's `<head>`, and
 * a field with no bound is a field that eventually holds a novel.
 */
const MAX_TITLE_LENGTH = 512
const MAX_DESCRIPTION_LENGTH = 2048

/**
 * `strictObject`, and the choice matters more than it looks.
 *
 * A plain `z.object` *strips* keys it does not recognise. Applied at a save
 * boundary that had never run before, that would have silently deleted whatever
 * an older build or a future one had stored there — a validator quietly
 * discarding data is worse than one that was never wired up, because the loss
 * is invisible and permanent. Refusing is the same decision the structured node
 * schemas make for the same reason: a key this build does not recognise is the
 * part of the document written for a reader that is not this one.
 *
 * If a key needs adding, it is added here, and old rows are migrated forward on
 * purpose rather than losing a field the next time somebody presses Save.
 */
export const SeoMeta = z.strictObject({
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  /**
   * A same-site canonical: a relative path, or an absolute https URL on the
   * site's verified host. Which host that is, is the renderer's question.
   */
  canonical: z.string().max(MAX_CANONICAL_LENGTH).optional(),
  social_image: z.string().optional(),
  noindex: z.boolean().default(false),
})
export type SeoMeta = z.infer<typeof SeoMeta>

/** One thing wrong with the metadata, named so an author can fix it. */
export type MetaProblem = { field: string; message: string }

export type ParsedPageMeta = { ok: true; meta: SeoMeta } | { ok: false; problems: MetaProblem[] }

/**
 * The one server-side boundary page metadata passes through on its way to being
 * stored.
 *
 * It exists because `SeoMeta` was exported and never called (finding S-02):
 * every constraint it declared was aspirational, and the only real bound on the
 * metadata a page could carry was the 1 MiB whole-content cap in migration
 * 0001. A schema nothing invokes is worse than no schema, because every reader
 * of the file believes it is running.
 *
 * Field-level problems rather than a single message, because "the metadata is
 * invalid" is not something an author can act on and "the canonical URL is
 * longer than 2048 characters" is.
 */
export function parsePageMeta(value: unknown): ParsedPageMeta {
  const parsed = SeoMeta.safeParse(value)
  if (parsed.success) return { ok: true, meta: parsed.data }
  return {
    ok: false,
    problems: parsed.error.issues.map(issue => ({
      field: issue.path.length > 0 ? issue.path.join('.') : 'metadata',
      message: issue.message,
    })),
  }
}
