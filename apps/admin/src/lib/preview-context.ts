/** Preview appearance is separate from page/definition content and publication. */
export type SitePreviewContext = 'published' | 'draft'

/** Unknown or omitted client values must never opt a preview into saved drafts. */
export function sitePreviewContext(value: unknown): SitePreviewContext {
  return value === 'draft' ? 'draft' : 'published'
}

/** The choice as a select offers it, beside the label "Site design". */
export function sitePreviewLabel(context: SitePreviewContext): string {
  return context === 'draft' ? 'Saved drafts' : 'Live'
}

/** The same choice inside a sentence: "Sample content with …". */
export function sitePreviewPhrase(context: SitePreviewContext): string {
  return context === 'draft' ? 'the saved, unpublished site design' : 'the live site design'
}
