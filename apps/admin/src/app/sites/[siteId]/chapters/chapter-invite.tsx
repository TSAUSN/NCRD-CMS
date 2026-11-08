import { useEffect, useState, useTransition } from 'react'
import type { ChapterRow } from '../../../../lib/chapters.ts'
import type { ChapterEditor } from '../../../../lib/local-chapter-mail.ts'
import { Button } from '../../../../components/ui/button.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { Drawer } from '../../../../components/ui/dialog.tsx'
import { inviteChapterEditorAction, loadChapterEditorsAction } from './actions.ts'
import workspace from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'

/** Record a local volunteer invitation with the current chapter revision. */
export function ChapterInvite({
  row,
  onClose,
  onSaved,
}: {
  row: ChapterRow
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [people, setPeople] = useState<ChapterEditor[]>([])
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => {
    let active = true
    void loadChapterEditorsAction(row.id)
      .then(result => {
        if (!active) return
        if (result.ok) setPeople(result.people)
        else setError(result.message)
      })
      .catch(() => {
        if (active) setError('The chapter editors could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [row.id])
  const invite = () => {
    setError('')
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Add the volunteer’s name and email address.')
      return
    }
    start(async () => {
      try {
        const result = await inviteChapterEditorAction({ chapterId: row.id, revision: row.revision, email, name })
        if (!result.ok) {
          setError(result.message)
          return
        }
        onSaved(result.message)
        onClose()
      } catch {
        setError('The invitation could not be confirmed. Retry after checking the connection.')
      }
    })
  }
  return (
    <Drawer
      density="compact"
      title={'Invite an editor for ' + row.config.name}
      onClose={onClose}
      pending={pending}
      footer={
        <Button loading={pending} onClick={invite}>
          Invite chapter editor
        </Button>
      }
    >
      <div className={listInspectorStyles.formStack}>
        <p>
          They can edit only {row.config.name}, then send their changes to the division for approval. Shared sections
          stay with the site team.
        </p>
        <p className={recordTableStyles.meta}>This local demo records the sign-in link. No email is sent. </p>
        {error && <p role="alert">{error}</p>}
        <Field density="compact" id="volunteer-name" label="Volunteer name" required>
          <input value={name} maxLength={120} autoComplete="name" onChange={event => setName(event.target.value)} />
        </Field>
        <Field density="compact" id="volunteer-email" label="Volunteer email" required>
          <input
            type="email"
            value={email}
            maxLength={254}
            autoComplete="email"
            onChange={event => setEmail(event.target.value)}
          />
        </Field>
        <h3 className={workspace.sectionHeading}>Chapter editors</h3>
        {people.length ? (
          <ul>
            {people.map(person => (
              <li key={person.id}>
                {person.name} · {person.email}
                {!person.enabled ? ' · Access paused' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>No chapter editors yet.</p>
        )}
      </div>
    </Drawer>
  )
}
