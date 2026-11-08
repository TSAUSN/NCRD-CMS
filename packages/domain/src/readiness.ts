// A shared readiness policy for the editor, reviews, bulk releases and schedules.
// The database also enforces rules that must never be bypassed, such as approved markup and resolvable sections.

/**
 * Reports and publication audits record this version. Schedules pin it at creation.
 * The worker refuses a schedule whose pinned policy differs. Plan an audited migration
 * for compatible scheduled actions before changing the version.
 */
export const READINESS_POLICY_VERSION = 3

export type ReadinessSeverity = 'blocking' | 'advisory'
export type ReadinessRule =
  | 'missing_title'
  | 'missing_h1'
  | 'missing_meta_description'
  | 'image_without_alt'
  | 'broken_internal_link'
  | 'refused_canonical'
  | 'empty_page'
  | 'sample_content'

export type ReadinessFinding = {
  rule: ReadinessRule
  severity: ReadinessSeverity
  /** Plain language, editor-facing. No jargon (SPEC §7). */
  message: string
  detail?: string
}

/**
 * The renderer's verdict on a canonical link it refused, narrowed to what a
 * readiness rule needs to say something useful about it.
 *
 * Declared structurally rather than imported from @cms/renderer. The rules here
 * are pure functions over a page and know nothing about how one is produced;
 * @cms/platform is the layer that composes the two, and it is where the value
 * comes from. `CanonicalDecision.refusal` is assignable to this as it stands.
 *
 * `authored` is deliberately absent even though the renderer carries it. A
 * finding is stored in `scheduled_actions.readiness_report` and copied into
 * `audit_log.detail`, so a field holding the raw authored value would write
 * `https://user:password@host/` into two more places, and SPEC §6.13 requires
 * credentials to be redacted before detail JSON is accepted. The renderer's own
 * message already quotes what the author wrote in every case where quoting it
 * is safe, and withholds it in the one case where it is not — so reusing that
 * message is both the actionable answer and the redacted one.
 */
export type RefusedCanonical = {
  /** Which canonical rule refused it, e.g. `other_host`. */
  rule: string
  /** Plain language, editor-facing, naming the authored value where it is safe to. */
  message: string
}

export type ReadinessInput = {
  title: string
  sampleContent?: readonly { section: string; fields: readonly string[] }[]
  metaDescription: string | undefined
  /** The page as the public renderer would emit it. */
  html: string
  sectionCount: number
  /** Paths that exist on this site, for internal-link checking. */
  knownPaths: ReadonlySet<string>
  /** Opted-in native section destinations; imported fragment links keep their existing rules. */
  sectionLinks?: readonly string[]
  knownAnchors?: ReadonlyMap<string, ReadonlySet<string>>
  draftAnchors?: ReadonlyMap<string, ReadonlySet<string>>
  /**
   * Set when the renderer refused the canonical link this page's author typed
   * and published the page's own address in its place (SPEC §6.8).
   *
   * Passed in rather than read out of `html`, because by the time there is an
   * `html` the refused value is gone and a perfectly good same-site canonical
   * is standing where it was. A check over the rendered page would see nothing
   * wrong, which is exactly why this rule waited for `renderPage` to start
   * returning `PageDocument.canonical`.
   */
  canonicalRefusal?: RefusedCanonical | null | undefined
}

export type ReadinessReport = {
  policyVersion: number
  findings: ReadinessFinding[]
  blocking: ReadinessFinding[]
  advisory: ReadinessFinding[]
  ok: boolean
}

const H1 = /<h1[\s>]/i
const IMG = /<img\b[^>]*>/gi
const ALT = /\balt\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i
// Explicitly decorative: a presentation role, or hidden from assistive technology
// altogether (authored V1 logos use `alt="" aria-hidden="true"`).
const ROLE_PRESENTATION =
  /\brole\s*=\s*("presentation"|'presentation'|"none"|'none')|\baria-hidden\s*=\s*("true"|'true')/i
const INTERNAL_HREF = /<a\b[^>]*\bhref\s*=\s*"(\/[^"]*)"/gi

export function runReadinessChecks(input: ReadinessInput): ReadinessReport {
  const findings: ReadinessFinding[] = []
  for (const sample of input.sampleContent ?? []) {
    if (sample.fields.length)
      findings.push({
        rule: 'sample_content',
        severity: 'blocking',
        message: `${sample.section} still contains sample content (${sample.fields.length} ${sample.fields.length === 1 ? 'field' : 'fields'}). Replace it or choose “Publish with sample content”.`,
        detail: sample.fields.join(', '),
      })
  }

  if (input.title.trim() === '') {
    findings.push({
      rule: 'missing_title',
      severity: 'blocking',
      message: 'This page needs a title. It appears in the browser tab and in search results.',
    })
  }

  if (input.sectionCount === 0) {
    findings.push({
      rule: 'empty_page',
      severity: 'blocking',
      message: 'This page has no sections yet, so there would be nothing to see.',
    })
  } else if (!H1.test(input.html)) {
    findings.push({
      rule: 'missing_h1',
      severity: 'blocking',
      message: 'This page has no main heading. Readers and search engines use it to know what the page is about.',
    })
  }

  if (!input.metaDescription || input.metaDescription.trim() === '') {
    findings.push({
      rule: 'missing_meta_description',
      severity: 'advisory',
      message: 'No search description set. Search results will show whatever text they find first.',
    })
  }

  // An invalid canonical is blocking because the rendered page would silently use a different address.
  // Reuse the renderer’s explanation so a rejected URL cannot expose its credentials.
  if (input.canonicalRefusal) {
    findings.push({
      rule: 'refused_canonical',
      severity: 'blocking',
      message:
        'The canonical link set on this page cannot be used, so this page would tell ' +
        `search engines it lives at its own address instead. ${input.canonicalRefusal.message}`,
      detail: input.canonicalRefusal.rule,
    })
  }

  // An image is either described or explicitly marked decorative. An empty
  // alt with role="presentation" is the decorative case and passes.
  for (const tag of input.html.match(IMG) ?? []) {
    const alt = ALT.exec(tag)
    const value = alt ? alt[1]!.replace(/^["']|["']$/g, '').trim() : null
    if (value === null || (value === '' && !ROLE_PRESENTATION.test(tag))) {
      findings.push({
        rule: 'image_without_alt',
        severity: 'blocking',
        message: 'An image has no description. Add one, or mark the image as decorative.',
        detail: tag.slice(0, 120),
      })
    }
  }

  const checkedDestinations = new Set<string>()
  for (const match of input.html.matchAll(INTERNAL_HREF)) {
    const href = match[1]!
    if (checkedDestinations.has(href)) continue
    checkedDestinations.add(href)
    const path = href
      .split('?')[0]!
      .split('#')[0]!
      .replace(/(.)\/$/, '$1')
    if (path.startsWith('//')) continue // protocol-relative: not an internal link
    if (!input.knownPaths.has(path === '' ? '/' : path)) {
      findings.push({
        rule: 'broken_internal_link',
        severity: 'blocking',
        message: `A link points to ${href}, which is not a published page on this site.`,
        detail: href,
      })
    }
  }

  for (const href of new Set(input.sectionLinks ?? [])) {
    if (!href.startsWith('/') || href.startsWith('//') || !href.includes('#')) continue
    const path =
      href
        .split('#')[0]!
        .split('?')[0]!
        .replace(/(.)\/$/, '$1') || '/'
    if (!input.knownPaths.has(path)) continue
    let fragment = ''
    try {
      fragment = decodeURIComponent(href.slice(href.indexOf('#') + 1))
    } catch {
      /* Invalid fragments remain missing destinations. */
    }
    if (fragment && !input.knownAnchors?.get(path)?.has(fragment))
      findings.push({
        rule: 'broken_internal_link',
        severity: 'blocking',
        message: input.draftAnchors?.get(path)?.has(fragment)
          ? 'A link points to a section waiting to be published on ' +
            path +
            '. Publish these pages together, or choose another destination.'
          : 'A link points to a section that is no longer on ' +
            path +
            '. Choose another section or the top of the page.',
        detail: href,
      })
  }
  const blocking = findings.filter(f => f.severity === 'blocking')
  return {
    policyVersion: READINESS_POLICY_VERSION,
    findings,
    blocking,
    advisory: findings.filter(f => f.severity === 'advisory'),
    ok: blocking.length === 0,
  }
}
