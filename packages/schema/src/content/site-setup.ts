import { z } from 'zod'
import { ThemeTokens } from './theme.ts'
import { GLOBAL_ELEMENT_LIMITS, HeaderConfigV1, FooterConfigV1 } from './global-elements.ts'

export const SiteSetupPage = z
  .object({
    slug: z
      .string()
      .max(160)
      .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/),
    title: z.string().trim().min(1).max(80),
    intro: z.string().trim().max(500),
    body: z.string().trim().max(5000),
    layout: z.enum(['content', 'resources', 'speakers', 'program']),
    template: z
      .enum([
        'echelon-home',
        'chapter-finder',
        'event-home',
        'speakers',
        'program',
        'visit',
        'sponsors',
        'resources',
        'landing',
        'chapter',
        'blank',
      ])
      .optional(),
    /** Whether the page starts in the site menu. Older setup files have no
     * choice recorded and keep every page in the menu, as they always did. */
    menu: z.boolean().default(true),
    /** Under the closest page above it that is not nested, as a drop-down in the
     * menu (V1 reference 23: “Nest puts a page underneath the one above it”).
     * One level deep; never under the home page. */
    nested: z.boolean().default(false),
    /** Listed among the footer's links when the site is created. */
    footer: z.boolean().default(false),
  })
  .strict()

/** The most pages one footer group can list (GLOBAL_ELEMENT_LIMITS.footerGroupLinks). */
export const SITE_SETUP_FOOTER_PAGES = 6

/** A portable wizard configuration, separate from a full content/site export. */
export const SiteSetup = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .max(40)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    kind: z.enum(['resource', 'event']),
    theme: ThemeTokens,
    header: HeaderConfigV1,
    footer: FooterConfigV1,
    pages: z.array(SiteSetupPage).min(1).max(12),
  })
  .strict()
  .superRefine((setup, context) => {
    if (setup.pages.filter(page => page.slug === '').length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['pages'],
        message: 'Keep exactly one home page with an empty address.',
      })
    }
    if (new Set(setup.pages.map(page => page.slug)).size !== setup.pages.length) {
      context.addIssue({ code: 'custom', path: ['pages'], message: 'Each page needs a different address.' })
    }
    for (const [index, page] of setup.pages.entries()) {
      if (!page.nested) continue
      const above = setup.pages
        .slice(0, index)
        .reverse()
        .find(candidate => !candidate.nested)
      if (page.slug === '' || !above || above.slug === '') {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'nested'],
          message: `“${page.title}” can be nested only under a page above it other than the home page.`,
        })
      }
    }
    if (setup.pages.filter(page => page.footer).length > SITE_SETUP_FOOTER_PAGES) {
      context.addIssue({
        code: 'custom',
        path: ['pages'],
        message: `Choose at most ${SITE_SETUP_FOOTER_PAGES} pages for the footer.`,
      })
    }
    if (setup.kind === 'resource' && setup.pages.some(page => ['speakers', 'program'].includes(page.layout))) {
      context.addIssue({
        code: 'custom',
        path: ['pages'],
        message: 'Speaker and program pages belong to an event starter.',
      })
    }
    // Links shared by every page may be planned when they go to a web address;
    // the site's own pages and media do not exist until it is created.
    if (setup.header.brand.logoMediaId || setup.header.brand.compactLogoMediaId) {
      context.addIssue({
        code: 'custom',
        path: ['header'],
        message: 'Add logos after creating the site, when its media is available.',
      })
    }
    const legal = setup.footer.legal
    const links = [
      ...setup.header.utilityLinks,
      ...(setup.header.cta ? [setup.header.cta] : []),
      ...setup.footer.groups.flatMap(group => group.links),
      ...[legal.privacy, legal.accessibility, legal.terms].filter(link => link !== null),
    ]
    if (links.some(link => link.target.type === 'page')) {
      context.addIssue({
        code: 'custom',
        path: ['header'],
        message:
          'Link to the site’s own pages after creating it, when they exist. Links planned here use a web address.',
      })
    }
    if (
      setup.footer.groups.length + (setup.pages.some(page => page.footer) ? 1 : 0) >
      GLOBAL_ELEMENT_LIMITS.footerGroups
    ) {
      context.addIssue({
        code: 'custom',
        path: ['footer'],
        message: `The footer holds at most ${GLOBAL_ELEMENT_LIMITS.footerGroups} groups of links, including the pages chosen for it.`,
      })
    }
  })
export type SiteSetup = z.infer<typeof SiteSetup>
export type SiteSetupPage = z.infer<typeof SiteSetupPage>
