import type { SiteSetupPage } from '@cms/schema'
import { CORE_PAGE_TEMPLATES } from '@cms/seeds/core-templates'

const LAYOUTS: Record<SiteSetupPage['layout'], string> = {
  content: 'Text page',
  resources: 'Resource list',
  speakers: 'Speaker list',
  program: 'Program',
}
export function wizardPageTemplateLabel(page: SiteSetupPage): string {
  const id = page.template ?? (page.layout !== 'content' ? page.layout : 'blank')
  return CORE_PAGE_TEMPLATES.find(template => template.id === id)?.name ?? LAYOUTS[page.layout]
}

export function nestParent(pages: readonly SiteSetupPage[], index: number): SiteSetupPage | null {
  const above = pages
    .slice(0, index)
    .reverse()
    .find(page => !page.nested)
  return above && above.slug !== '' && pages[index]?.slug !== '' ? above : null
}
/** After a move or removal, a page that can no longer be nested comes back to the top level. */
export const keepNestingValid = (pages: SiteSetupPage[]) =>
  pages.map((page, index) => (page.nested && !nestParent(pages, index) ? { ...page, nested: false } : page))
/** What a page's plan says beyond its layout, in the summary and the review. */
export function pageNotes(pages: readonly SiteSetupPage[], index: number): string {
  const page = pages[index]!
  const parent = page.nested ? nestParent(pages, index) : null
  return [
    parent ? `under ${parent.title || 'the page above'}` : '',
    page.menu ? '' : 'not in the menu',
    page.footer ? 'in the footer' : '',
  ]
    .filter(Boolean)
    .map(note => ` · ${note}`)
    .join('')
}
