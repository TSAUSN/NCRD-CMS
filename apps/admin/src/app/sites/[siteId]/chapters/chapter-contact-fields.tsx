import type { ChapterSetup } from '@cms/schema'
import { Field } from '../../../../components/ui/field.tsx'
import workspace from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'

/** These details are private and apply to the chapter's scheduled checks. */
export function ChapterContactFields({
  divisionPage,
  contact,
  onChange,
}: {
  divisionPage: boolean
  contact: ChapterSetup['contact']
  onChange: (contact: ChapterSetup['contact']) => void
}) {
  return (
    <>
      <h3 className={workspace.sectionHeading}>{divisionPage ? 'Who to ask about it' : 'Point of contact'}</h3>
      <p className={recordTableStyles.meta}>
        {divisionPage
          ? 'There’s no chapter page to edit on this site. January and July reminders go to the contact below, asking them to check the address still works.'
          : 'One contact receives the January and July checks. These details are private.'}
      </p>
      {(['name', 'role', 'email'] as const).map(key => (
        <Field
          density="compact"
          key={key}
          id={'chapter-contact-' + key}
          label={key === 'name' ? 'Contact name' : key === 'role' ? 'Contact role' : 'Contact email'}
          required
        >
          <input
            type={key === 'email' ? 'email' : 'text'}
            value={contact[key]}
            maxLength={key === 'email' ? 254 : 120}
            onChange={event => onChange({ ...contact, [key]: event.target.value })}
          />
        </Field>
      ))}
    </>
  )
}
