import { SitePublicSettings, SITE_SOCIAL_LABELS, type SiteSocialAccount } from './site-settings.ts'
import { clearSampleField } from './sample-content.ts'
import { repeatItemSlotId, type FieldLike } from './repeat-items.ts'
const accountLayouts: Readonly<Record<string, { hideSampleNote?: true; newTab?: true }>> = {
  'core-on-page-navigation': {},
  'core-echelon-follow': { hideSampleNote: true },
  'core-echelon-jump-links': { newTab: true },
}

export function siteSocialHidesSampleNote(slug: string | undefined): boolean {
  return accountLayouts[slug ?? '']?.hideSampleNote === true
}
export function siteSocialGroup(slots: readonly FieldLike[]): 'links' | 'social' {
  return slots.some(slot => slot.id === 'accounts_from' && slot.constraints?.siteSocialGroup === 'social')
    ? 'social'
    : 'links'
}
/** Only declared Links layouts explicitly connected to site accounts opt in. */
export function usesSiteSocialAccounts(
  values: Record<string, unknown>,
  slots: readonly FieldLike[],
  slug?: string,
): boolean {
  return (
    Object.hasOwn(accountLayouts, slug ?? '') &&
    values.accounts_from === 'site' &&
    slots.some(slot => slot.id === 'accounts_from' && slot.constraints?.siteSocialAccounts === true)
  )
}
export function siteSocialAccounts(settings: unknown): SiteSocialAccount[] | undefined {
  const parsed = SitePublicSettings.safeParse(settings)
  return parsed.success ? parsed.data.social : undefined
}
/** Derived values never write page drafts or overwrite chapter-owned links. */
export function siteSocialSectionValues(
  values: Record<string, unknown>,
  slots: readonly FieldLike[],
  slug: string | undefined,
  settings: unknown,
): Record<string, unknown> {
  if (
    !Object.hasOwn(accountLayouts, slug ?? '') ||
    !slots.some(slot => slot.id === 'accounts_from' && slot.constraints?.siteSocialAccounts === true)
  )
    return values
  let next = clearSampleField({ ...values }, 'accounts_from')
  if (!usesSiteSocialAccounts(values, slots, slug)) return next
  if (siteSocialHidesSampleNote(slug)) {
    next = clearSampleField(next, 'sample_note')
    next.sample_note = ''
  }
  const group = siteSocialGroup(slots)
  for (const key of Object.keys(next))
    if (key === group || key.startsWith(group + '__')) {
      next = clearSampleField(next, key)
      delete next[key]
    }
  const rows = (siteSocialAccounts(settings) ?? []).filter(row => row.url)
  const items = rows.map((_, index) => 's' + index)
  next[group] = { items }
  rows.forEach((row, index) => {
    next[repeatItemSlotId(group, items[index]!, 'action')] = {
      url: row.url,
      label: SITE_SOCIAL_LABELS[row.service],
      ...(accountLayouts[slug ?? '']?.newTab ? { newTab: true } : {}),
    }
  })
  return next
}
