import { useEffect, useRef, useState, useTransition } from 'react'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { useRouter } from 'next/navigation'
import { ChapterSetup, chapterUsesLinkedPage } from '@cms/schema'
import type { ChapterRow, ChapterDivision } from '../../../../lib/chapters.ts'
import { Button } from '../../../../components/ui/button.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { Drawer, Dialog } from '../../../../components/ui/dialog.tsx'
import { ProgressSteps } from '../../../../components/ui/controls.tsx'
import { TextLink as Link } from '../../../../components/ui/index.ts'
import { saveChapterAction } from './actions.ts'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { ChapterDestinationFields } from './chapter-destination-fields.tsx'
import { ChapterContactFields } from './chapter-contact-fields.tsx'
import { ChapterSectionFields } from './chapter-section-fields.tsx'

/** The setup draft, its three steps, and its acknowledged save belong together. */
export function ChapterForm({
  row,
  siteId,
  onClose,
  onSaved,
  divisions,
  defaultMode,
  canAssignDivision,
}: {
  row: ChapterRow | null
  siteId: string
  divisions: ChapterDivision[]
  defaultMode: ChapterSetup['updateMode']
  canAssignDivision: boolean
  onClose: () => void
  onSaved: (row: ChapterRow, message: string) => void
}) {
  const router = useRouter(),
    [config, setConfig] = useState<ChapterSetup>(
      row?.config ?? {
        ...ChapterSetup.parse({
          name: '[Chapter name]',
          destination: 'page',
          pageId: null,
          externalUrl: null,
          contact: { name: '[Name]', role: '[Role]', email: 'chapter@example.test' },
          sections: {},
        }),
        name: '',
        updateMode: defaultMode,
      },
    ),
    [divisionId, setDivisionId] = useState(
      row ? (row.divisionId ?? '') : divisions.length === 1 ? divisions[0]!.id : '',
    ),
    [step, setStep] = useState(0),
    [pending, start] = useTransition(),
    [error, setError] = useState(''),
    errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error && !pending) errorRef.current?.focus()
  }, [error, pending])
  const change = <K extends keyof ChapterSetup>(key: K, value: ChapterSetup[K]) => {
    setError('')
    setConfig(previous => ({ ...previous, [key]: value }))
  }
  const divisionPage = config.destination === 'division'
  const initial = useRef(JSON.stringify({ config, divisionId })),
    signature = JSON.stringify({ config, divisionId }),
    dirty = signature !== initial.current
  const persist = async (): Promise<{ ok: boolean; message?: string }> => {
    setError('')
    if (!row && !canAssignDivision && !divisionId) {
      const message = 'Choose the division that will review this chapter.'
      setError(message)
      return { ok: false, message }
    }
    const parsed = ChapterSetup.safeParse({
      ...config,
      externalUrl: chapterUsesLinkedPage(config.destination) ? config.externalUrl : null,
    })
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join('.'),
        message =
          field === 'externalUrl'
            ? 'Use the full https address for the ' + (divisionPage ? 'division page.' : 'chapter website.')
            : field === 'name'
              ? 'Add a chapter name.'
              : field === 'contact.email'
                ? 'Enter a valid contact email address.'
                : 'Add the required contact name, role and email. Your entries are still here.'
      setError(message)
      return { ok: false, message }
    }
    const slug =
      row?.slug ??
      config.name
        .toLowerCase()
        .replace(/\bchapter\b/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    try {
      const outcome = await saveChapterAction({
        siteId,
        id: row?.id ?? null,
        revision: row?.revision ?? '0',
        slug,
        config: parsed.data,
        divisionId: divisionId || null,
      })
      if (!outcome.ok) {
        setError(outcome.message)
        return outcome
      }
      initial.current = signature
      router.refresh()
      onSaved(outcome.row, outcome.message)
      return { ok: true }
    } catch {
      const message =
        'The save could not be confirmed. Your entries are still here; retry after checking the connection.'
      setError(message)
      return { ok: false, message }
    }
  }
  const save = () =>
      start(async () => {
        await persist()
      }),
    readGuard = () => ({
      dirty,
      pending,
      draft: {
        label: config.name || 'New chapter',
        saved: false,
        saveDraft: () =>
          new Promise<{ ok: boolean; message?: string }>(resolve => start(async () => resolve(await persist()))),
        discard: () => {
          initial.current = signature
        },
      },
    })
  useNavigationGuard(readGuard)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const close = () => {
    if (requestLocalDraftNavigation(readGuard, onClose)) onClose()
  }
  const divisionChoice = divisions.length > 0 && (
    <Field
      density="compact"
      id="chapter-division"
      label="Division web team"
      help="This team reviews chapter submissions."
    >
      <select
        value={divisionId}
        disabled={Boolean(row) && !canAssignDivision}
        onChange={event => setDivisionId(event.target.value)}
      >
        {canAssignDivision ? (
          <option value="">National team only</option>
        ) : (
          <option value="" disabled>
            Choose a division
          </option>
        )}
        {divisions.map(division => (
          <option key={division.id} value={division.id}>
            {division.name}
          </option>
        ))}
      </select>
    </Field>
  )
  const ChapterDialog = row ? Drawer : Dialog
  return (
    <ChapterDialog
      density="compact"
      size={row ? 'standard' : 'large'}
      title={row ? 'Set up ' + row.config.name : 'Add a chapter'}
      onClose={close}
      pending={pending}
      footer={
        <div className={workspaceFormsStyles.actions}>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Cancel
          </Button>
          {!divisionPage && step > 0 && (
            <Button variant="secondary" disabled={pending} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {divisionPage ? (
            <Button loading={pending} onClick={save}>
              Save draft
            </Button>
          ) : step < 2 ? (
            <Button
              onClick={() => {
                if (
                  step === 0 &&
                  (!config.name.trim() ||
                    (config.destination === 'external' && !/^https:\/\//.test(config.externalUrl ?? '')))
                ) {
                  setError('Add a chapter name and, for an own website, its full https address.')
                  return
                }
                setError('')
                setStep(step + 1)
              }}
            >
              Continue
            </Button>
          ) : (
            <Button loading={pending} onClick={save}>
              Save chapter
            </Button>
          )}
        </div>
      }
    >
      <div className={listInspectorStyles.formStack + ' ' + workspaceFormsStyles.compactForm}>
        {!divisionPage && (
          <>
            <ProgressSteps steps={['Chapter', 'Sections', 'People']} current={step} label="Chapter setup steps" />
            <p className={recordTableStyles.meta}>
              Step {step + 1} of 3 · {['Chapter', 'Sections', 'People'][step]}
            </p>
          </>
        )}
        {error && (
          <p role="alert" ref={errorRef} tabIndex={-1}>
            {error}
          </p>
        )}
        {step === 0 && (
          <>
            <Field density="compact" id="chapter-name" label="Chapter name" required>
              <input value={config.name} maxLength={160} onChange={event => change('name', event.target.value)} />
            </Field>
            <ChapterDestinationFields
              currentDestination={config.destination}
              externalUrl={config.externalUrl}
              onDestination={destination => {
                change('destination', destination)
                setStep(0)
              }}
              onAddress={address => change('externalUrl', address)}
            />
            {divisionPage && (
              <>
                <p className={recordTableStyles.meta}>
                  Address not checked automatically. Check the saved page address before publishing.
                </p>
                {divisionChoice}
                <ChapterContactFields
                  divisionPage={divisionPage}
                  contact={config.contact}
                  onChange={value => change('contact', value)}
                />
              </>
            )}
            <p className={recordTableStyles.meta}>
              New chapter pages stay in draft until reviewed and published. Chapters with their own website need no CMS
              page.
            </p>
            {config.pageId && !chapterUsesLinkedPage(config.destination) && (
              <Link href={'/pages/' + config.pageId}>Open chapter page</Link>
            )}
          </>
        )}
        {!divisionPage && step === 1 && (
          <ChapterSectionFields
            config={config}
            onSections={value => change('sections', value)}
            onBoardDisplay={value => change('boardDisplay', value)}
          />
        )}
        {!divisionPage && step === 2 && (
          <>
            {divisionChoice}
            <Field density="compact" id="chapter-update-mode" label="How the page gets updated">
              <select
                value={config.updateMode}
                onChange={event => change('updateMode', event.target.value as ChapterSetup['updateMode'])}
              >
                <option value="division">Division web team makes changes</option>
                <option value="chapter-editors">Chapter editors sign in; the division approves</option>
              </select>
            </Field>
            <ChapterContactFields
              divisionPage={divisionPage}
              contact={config.contact}
              onChange={value => change('contact', value)}
            />
          </>
        )}
      </div>
    </ChapterDialog>
  )
}
