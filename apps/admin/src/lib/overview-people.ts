import type { PersonRow } from './people.ts'
/** Samples remain available in the access-management workspace, not the site summary. */
export function overviewPerson(person: Pick<PersonRow, 'display_name' | 'email'>): boolean {
  return !/^\s*\[/.test(person.display_name) && !/\(sample\)/i.test(person.display_name)
}
