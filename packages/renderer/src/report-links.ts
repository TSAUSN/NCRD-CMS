import { stripPreviewInstrumentation } from './preview-runtime.ts'
/** Both visitor widths use the same sanitized, derived links. No authored HTML. */
export function reportLinksMarkup(body: string, slug: string | undefined): string {
  if (slug !== 'core-report-page-links') return body
  const links = /<nav class="ar-jump" aria-label="On this page">([\s\S]*?)<\/nav>/.exec(body)?.[1] ?? ''
  const clean = stripPreviewInstrumentation(links)
  return body
    .replace(links, () => clean)
    .replace(
      '<div data-report-links-copy="true"></div>',
      () => '<nav aria-label="On this page on phones">' + clean + '</nav>',
    )
}
