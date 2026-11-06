import { roleDisplayName } from './role-display.ts'
import type { PersonRow } from './people.ts'
export function personAccessSummary(
  person: Pick<PersonRow, 'super_admin' | 'memberships' | 'pageAssignments' | 'divisionAssignments'>,
): string {
  if (person.super_admin) return 'All sites'
  const counts = [
    [person.memberships.length, 'site', 'sites'],
    [person.pageAssignments.length, 'chapter page', 'chapter pages'],
    [person.divisionAssignments.length, 'division', 'divisions'],
  ] as const
  return (
    counts
      .filter(([count]) => count > 0)
      .map(([count, singular, plural]) => `${count} ${count === 1 ? singular : plural}`)
      .join(' · ') || 'No assigned access'
  )
}
export function personRoles(
  person: Pick<PersonRow, 'super_admin' | 'memberships' | 'pageAssignments' | 'divisionAssignments'>,
): string {
  if (person.super_admin) return 'Super admin'
  const labels = new Set(person.memberships.map(item => roleDisplayName(item.role)))
  if (person.pageAssignments.length) labels.add(roleDisplayName('contributor'))
  if (person.divisionAssignments.length) labels.add(roleDisplayName('editor') + ' · division')
  return [...labels].join(' · ') || 'No role assigned'
}
