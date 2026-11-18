'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Card, CardContent, Field, IconButton, Note } from '../../../components/ui/index.ts'
import { ConfirmDialog } from '../../../components/confirm.tsx'
import { IconArrowDown, IconArrowUp, IconEye, IconEyeOff, IconPlus, IconTrash } from '../../../components/icons.tsx'
import {
  validateCards,
  type CardEdit,
  type CardProblem,
  type DisasterItem,
  type DisasterLink,
} from '../../../lib/disaster-cards.ts'
import { pushCurrentDisasters } from './actions.ts'
import styles from './disaster-editor.module.css'

type Props = { version: number; updatedAt: string | null; initialItems: DisasterItem[]; livePage: string }

const ZESTY_MEDIA = /^https:\/\/[a-z0-9-]+\.media\.zestyio\.com\//i

function toEdit(item: DisasterItem): CardEdit {
  return item.kind === 'locked'
    ? { key: item.key, kind: 'locked' }
    : {
        key: item.key,
        kind: 'card',
        hidden: item.hidden,
        title: item.title,
        description: item.description,
        imageUrl: item.imageUrl,
        learnMore: item.learnMore,
        donate: item.donate,
      }
}

function blankCard(): CardEdit {
  return {
    key: `new-${crypto.randomUUID().slice(0, 8)}`,
    kind: 'card',
    hidden: false,
    title: '',
    description: '',
    imageUrl: '',
    learnMore: { href: '', label: 'Learn More' },
    donate: { href: '', label: 'Donate' },
  }
}

export function DisasterEditor({ version, updatedAt, initialItems, livePage }: Props) {
  const router = useRouter()
  const original = useMemo(() => initialItems.map(toEdit), [initialItems])
  const byKey = useMemo(() => new Map(initialItems.map(item => [item.key, item])), [initialItems])
  const [edits, setEdits] = useState<CardEdit[]>(original)
  const [open, setOpen] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [serverProblems, setServerProblems] = useState<CardProblem[]>([])
  const [pending, startTransition] = useTransition()
  const [showProblems, setShowProblems] = useState(false)

  const dirty = JSON.stringify(edits) !== JSON.stringify(original)
  const problems = showProblems ? [...validateCards(edits), ...serverProblems] : serverProblems
  const shown = edits.filter(edit => !('hidden' in edit) || !edit.hidden).length

  function update(key: string, change: Partial<Extract<CardEdit, { kind: 'card' }>>) {
    setResult(null)
    setEdits(list => list.map(edit => (edit.key === key && edit.kind === 'card' ? { ...edit, ...change } : edit)))
  }
  function move(index: number, by: -1 | 1) {
    setResult(null)
    setEdits(list => {
      const next = [...list]
      const [entry] = next.splice(index, 1)
      if (entry) next.splice(index + by, 0, entry)
      return next
    })
  }
  function remove(key: string) {
    setResult(null)
    setEdits(list => list.filter(edit => edit.key !== key))
  }
  function add() {
    const card = blankCard()
    setResult(null)
    setEdits(list => [card, ...list])
    setOpen(card.key)
  }
  function requestPush() {
    setShowProblems(true)
    const found = validateCards(edits)
    if (found.length) {
      setOpen(found[0]?.key ?? null)
      setResult({ ok: false, message: 'Fix the highlighted fields before pushing.' })
      return
    }
    setConfirming(true)
  }
  function push() {
    startTransition(async () => {
      const outcome = await pushCurrentDisasters({ version, edits })
      setConfirming(false)
      setResult({ ok: outcome.ok, message: outcome.message })
      setServerProblems(outcome.ok ? [] : (outcome.problems ?? []))
      if (outcome.ok) {
        setShowProblems(false)
        router.refresh()
      }
    })
  }

  return (
    <div className={styles.editor}>
      <Card density="compact">
        <CardContent>
          <div className={styles.toolbar}>
            <div className={styles.status}>
              <strong>
                {shown} shown · {edits.length - shown} hidden
              </strong>
              <span>
                Zesty version {version}
                {updatedAt ? ` · last saved ${updatedAt} UTC` : ''}
              </span>
              {dirty && <Badge tone="pending">Unpushed changes</Badge>}
            </div>
            <div className={styles.toolbarActions}>
              <a className={styles.liveLink} href={livePage} target="_blank" rel="noreferrer">
                View live page
              </a>
              <Button variant="secondary" onClick={add}>
                <IconPlus size={16} /> Add card
              </Button>
              {dirty && (
                <Button
                  variant="tertiary"
                  onClick={() => {
                    setEdits(original)
                    setResult(null)
                    setShowProblems(false)
                  }}
                >
                  Discard changes
                </Button>
              )}
              <Button variant="publish" disabled={!dirty || pending} onClick={requestPush}>
                Push to live site
              </Button>
            </div>
          </div>
          {result && (
            <p className={'notice ' + (result.ok ? 'notice-ok' : 'notice-error')} role={result.ok ? 'status' : 'alert'}>
              {result.message}
            </p>
          )}
        </CardContent>
      </Card>

      <ol className={styles.list}>
        {edits.map((edit, index) => {
          const source = byKey.get(edit.key)
          const cardProblems = problems.filter(problem => problem.key === edit.key)
          const changed = JSON.stringify(edit) !== JSON.stringify(original.find(entry => entry.key === edit.key))
          const position = (
            <div className={styles.cardActions}>
              <IconButton variant="tertiary" tooltip="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                <IconArrowUp size={16} />
              </IconButton>
              <IconButton
                variant="tertiary"
                tooltip="Move down"
                disabled={index === edits.length - 1}
                onClick={() => move(index, 1)}
              >
                <IconArrowDown size={16} />
              </IconButton>
            </div>
          )
          if (edit.kind === 'locked')
            return (
              <li key={edit.key} className={styles.item} data-locked>
                <div className={styles.cardMain}>
                  <div className={styles.cardText}>
                    <div className={styles.badges}>
                      <Badge tone="info">Kept as is</Badge>
                      {source?.hidden && <Badge>Hidden</Badge>}
                    </div>
                    <p className={styles.description}>
                      {source?.kind === 'locked' ? source.summary : 'Content this tool cannot edit.'}
                    </p>
                    <p className={styles.help}>This block doesn’t match the card layout, so edit it in Zesty.</p>
                  </div>
                  {position}
                </div>
              </li>
            )
          const imageClass = source?.kind === 'card' ? source.imageClass : null
          const editing = open === edit.key
          return (
            <li key={edit.key} className={styles.item} data-hidden={edit.hidden || undefined}>
              <div className={styles.cardMain}>
                <div className={styles.thumb} aria-hidden="true">
                  {edit.imageUrl && ZESTY_MEDIA.test(edit.imageUrl) ? (
                    <img src={edit.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{edit.imageUrl ? 'Image' : imageClass ? `Site image: ${imageClass}` : 'No image'}</span>
                  )}
                </div>
                <div className={styles.cardText}>
                  <div className={styles.badges}>
                    {edit.hidden && <Badge>Hidden</Badge>}
                    {edit.key.startsWith('new-') ? (
                      <Badge tone="pending">New</Badge>
                    ) : (
                      changed && <Badge tone="pending">Changed</Badge>
                    )}
                    {cardProblems.length > 0 && <Badge tone="error">Needs attention</Badge>}
                  </div>
                  <h3 className={styles.title}>{edit.title || 'Untitled card'}</h3>
                  <p className={styles.description}>{edit.description}</p>
                  <p className={styles.help}>
                    {edit.learnMore
                      ? `${edit.learnMore.label} → ${edit.learnMore.href || '(no link)'}`
                      : 'No Learn More button'}
                    <br />
                    {edit.donate ? `${edit.donate.label} → ${edit.donate.href || '(no link)'}` : 'No Donate button'}
                  </p>
                  <div className={styles.rowActions}>
                    <Button
                      variant="secondary"
                      size="s"
                      aria-expanded={editing}
                      onClick={() => setOpen(editing ? null : edit.key)}
                    >
                      {editing ? 'Close' : 'Edit'}
                    </Button>
                    <Button variant="tertiary" size="s" onClick={() => update(edit.key, { hidden: !edit.hidden })}>
                      {edit.hidden ? <IconEye size={16} /> : <IconEyeOff size={16} />}
                      {edit.hidden ? 'Show on page' : 'Hide from page'}
                    </Button>
                    <Button variant="tertiary" size="s" onClick={() => remove(edit.key)}>
                      <IconTrash size={16} /> Remove
                    </Button>
                  </div>
                </div>
                {position}
              </div>
              {editing && (
                <CardForm
                  edit={edit}
                  imageClass={imageClass}
                  problems={cardProblems}
                  onChange={change => update(edit.key, change)}
                />
              )}
            </li>
          )
        })}
      </ol>

      {confirming && (
        <ConfirmDialog
          title="Push to the live site?"
          tone="publish"
          what={
            <>
              This saves a new version of the Current Disasters page in Zesty and publishes it on salvationarmyusa.org
              right away. {shown} cards will show.
            </>
          }
          reassurance="Earlier versions stay in Zesty’s history, so a mistake can be rolled back there."
          confirmLabel="Push and publish"
          pending={pending}
          error={result && !result.ok ? result.message : undefined}
          onConfirm={push}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

type CardChange = Partial<Extract<CardEdit, { kind: 'card' }>>

function CardForm({
  edit,
  imageClass,
  problems,
  onChange,
}: {
  edit: Extract<CardEdit, { kind: 'card' }>
  imageClass: string | null
  problems: CardProblem[]
  onChange: (change: CardChange) => void
}) {
  const id = (field: string) => `${edit.key}-${field}`
  const error = (field: CardProblem['field']) => problems.find(problem => problem.field === field)?.message
  function linkFields(field: 'learnMore' | 'donate', name: string, defaultLabel: string) {
    const value: DisasterLink | null = edit[field]
    return (
      <fieldset className={styles.linkGroup}>
        <legend>{name} button</legend>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={value !== null}
            onChange={event => onChange({ [field]: event.target.checked ? { href: '', label: defaultLabel } : null })}
          />
          Show a {name} button
        </label>
        {value && (
          <div className={styles.linkFields}>
            <Field id={id(`${field}-label`)} label="Button text" density="compact">
              <input
                value={value.label}
                onChange={event => onChange({ [field]: { ...value, label: event.target.value } })}
              />
            </Field>
            <Field id={id(`${field}-href`)} label="Link" density="compact" error={error(field)}>
              <input
                type="url"
                inputMode="url"
                placeholder="https://"
                value={value.href}
                onChange={event => onChange({ [field]: { ...value, href: event.target.value } })}
              />
            </Field>
          </div>
        )}
      </fieldset>
    )
  }
  return (
    <div className={styles.form}>
      <Field id={id('title')} label="Title" required error={error('title')}>
        <input value={edit.title} onChange={event => onChange({ title: event.target.value })} />
      </Field>
      <Field id={id('description')} label="Description" required error={error('description')}>
        <textarea rows={5} value={edit.description} onChange={event => onChange({ description: event.target.value })} />
      </Field>
      <Field
        id={id('image')}
        label="Image address"
        error={error('imageUrl')}
        help={
          imageClass && edit.imageUrl === null
            ? `This card’s image comes from the site stylesheet (${imageClass}). Add an address to replace it.`
            : 'Upload the image to Zesty Media first, then paste its address here.'
        }
      >
        <input
          type="url"
          inputMode="url"
          placeholder="https://…media.zestyio.com/…"
          value={edit.imageUrl ?? ''}
          onChange={event => onChange({ imageUrl: event.target.value || (imageClass ? null : '') })}
        />
      </Field>
      {linkFields('learnMore', 'Learn More', 'Learn More')}
      {linkFields('donate', 'Donate', 'Donate')}
      <Note tone="info">Text is published exactly as typed. Formatting and HTML are not supported in cards.</Note>
    </div>
  )
}
