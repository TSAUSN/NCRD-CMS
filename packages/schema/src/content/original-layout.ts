import { z } from 'zod'

/** Closed document attributes, never HTML, styles, events or resource authority. */
export const OriginalDocumentAttributes = z.preprocess(
  (value, context) => {
    if (value && typeof value === 'object' && Object.hasOwn(value, '__proto__')) {
      context.addIssue({ code: 'custom', message: 'Use only plain document attributes.' })
      return z.NEVER
    }
    return value
  },
  z
    .record(
      z
        .string()
        .regex(
          /^(?:id|class|lang|dir|role|data-(?!cms(?:-|$))[a-z0-9]+(?:-[a-z0-9]+)*|aria-[a-z0-9]+(?:-[a-z0-9]+)*)$/,
        ),
      z.string().max(4096),
    )
    .superRefine((attributes, context) => {
      if (Object.keys(attributes).length > 64)
        context.addIssue({ code: 'custom', message: 'Too many document attributes.' })
      for (const [name, value] of Object.entries(attributes)) {
        if (
          !/^(?:id|class|lang|dir|role|data-(?!cms(?:-|$))[a-z0-9]+(?:-[a-z0-9]+)*|aria-[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(
            name,
          ) ||
          /[\u0000-\u001f\u007f]/.test(value)
        )
          context.addIssue({ code: 'custom', message: 'Use only plain document attributes.' })
        if (name === 'dir' && !['ltr', 'rtl', 'auto'].includes(value))
          context.addIssue({ code: 'custom', message: 'Choose a text direction.' })
      }
    }),
)
export const OriginalDefinitionPin = z.strictObject({
  section_def_id: z.uuid(),
  section_def_version: z.number().int().positive().max(2147483647),
})
export const OriginalPageDefaults = z.strictObject({
  html: OriginalDocumentAttributes,
  body: OriginalDocumentAttributes,
  header: z.boolean(),
  footer: z.boolean(),
  quirks: z.boolean().optional(),
})
export const OriginalPageLayout = OriginalPageDefaults.extend({ pageId: z.uuid() })
/** Root-reviewed identity/version pins only; the normal AST and CSS policies
 * still decide what a definition is allowed to render. No raw HTML bypass. */
export const SiteOriginalLayout = z
  .strictObject({
    version: z.literal(1),
    definitions: z.array(OriginalDefinitionPin).max(2000),
    pages: z.array(OriginalPageLayout).max(500),
    newPages: OriginalPageDefaults.optional(),
  })
  .superRefine((layout, context) => {
    if (
      new Set(layout.definitions.map(pin => pin.section_def_id + ':' + pin.section_def_version)).size !==
      layout.definitions.length
    )
      context.addIssue({ code: 'custom', message: 'Choose each original layout only once.' })
    if (new Set(layout.pages.map(page => page.pageId)).size !== layout.pages.length)
      context.addIssue({ code: 'custom', message: 'Choose each original page only once.' })
  })
export type SiteOriginalLayout = z.infer<typeof SiteOriginalLayout>
