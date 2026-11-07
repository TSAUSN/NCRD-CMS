'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ButtonLink, Card, Field, Note } from '../../../../../components/ui/index.ts'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'
import { turnOnStories } from './actions.ts'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../../components/workspace-styles/selection-controls.module.css'
export function StoriesSetup({ siteId }: { siteId: string }) {
  const router = useRouter(),
    [mainLabel, setMain] = useState('Main tags'),
    [secondaryLabel, setSecondary] = useState('Secondary tags'),
    [publishUnreviewed, setReview] = useState(true),
    [pending, start] = useTransition(),
    [error, setError] = useState(''),
    busy = useRef(false),
    done = useRef(false)
  const dirty =
    !done.current && (mainLabel !== 'Main tags' || secondaryLabel !== 'Secondary tags' || !publishUnreviewed)
  useNavigationGuard(() => ({
    dirty,
    pending: busy.current,
    draft: {
      label: 'Stories setup',
      saveDraft: () => save(false),
      discard: () => {
        setMain('Main tags')
        setSecondary('Secondary tags')
        setReview(true)
        setError('')
      },
    },
  }))
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty || busy.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty])
  async function save(openLibrary: boolean): Promise<{ ok: boolean; message?: string }> {
    if (busy.current) return { ok: false, message: 'Wait for Stories setup to finish.' }
    busy.current = true
    setError('')
    try {
      const result = await turnOnStories(siteId, { mainLabel, secondaryLabel, publishUnreviewed })
      if (!result.ok) {
        setError(result.message)
        return result
      }
      done.current = true
      if (openLibrary) {
        router.replace('/sites/' + siteId + '/stories')
        router.refresh()
      }
      return { ok: true }
    } catch {
      const message = 'The result could not be confirmed. Try again; an existing library will be kept.'
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
    }
  }
  return (
    <Card title="Start with an empty Stories library" density="settings">
      <form
        className={workspaceFormsStyles.compactFields}
        onSubmit={event => {
          event.preventDefault()
          start(async () => {
            await save(true)
          })
        }}
      >
        <p>
          Stories use this site’s own tags. Add photos and words in Stories, then choose tags to show them on pages.
        </p>
        <Field
          id="stories-main-name"
          label="Main tag group name"
          required
          help="For example, Project Sectors or Topics."
        >
          <input value={mainLabel} maxLength={80} disabled={pending} onChange={event => setMain(event.target.value)} />
        </Field>
        <Field
          id="stories-secondary-name"
          label="Secondary tag group name"
          required
          help="For example, Regions or Locations."
        >
          <input
            value={secondaryLabel}
            maxLength={80}
            disabled={pending}
            onChange={event => setSecondary(event.target.value)}
          />
        </Field>
        <label className={selectionControlsStyles.toggleRow}>
          <span>Include unreviewed stories in feeds</span>
          <input
            type="checkbox"
            checked={publishUnreviewed}
            disabled={pending}
            onChange={event => setReview(event.target.checked)}
          />
        </label>
        <p className={recordTableStyles.meta}>
          When this is off, a story needs Reviewed before it appears in feeds. Either way, saved drafts wait for
          publishing.
        </p>
        <Note>The library starts empty. Stories and tag changes stay private until published.</Note>
        {error && <p role="alert">{error}</p>}
        <div className={workspaceFormsStyles.actions}>
          <ButtonLink variant="secondary" href={'/sites/' + siteId + '/settings?tab=publishing'}>
            Cancel
          </ButtonLink>
          <Button type="submit" loading={pending}>
            Turn on Stories
          </Button>
        </div>
      </form>
    </Card>
  )
}
