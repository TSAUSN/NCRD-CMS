'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { PageRecipe, RecipeSource, RecipeSection } from '../../../../lib/page-recipes.ts'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import { confirmClientNavigation, useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { RecipeBindingFields } from '../../../../components/recipe-bindings.tsx'
import {
  recipeBindingRequirements,
  type RecipeBindings,
  type RecipeTarget,
} from '../../../../lib/recipe-reuse-model.ts'
import { changeRecipe, type RecipeActionState } from './actions.ts'
import styles from './recipes.module.css'

const initial: RecipeActionState = { ok: false, message: '' }
function valueLabel(section: RecipeSection) {
  const values = Object.values(section.values)
  const bindings = values.filter(value => value !== null && typeof value === 'object' && 'readerKey' in value)
  return values.length > bindings.length ? 'Chosen samples' : bindings.length ? 'Collection bindings' : 'Empty fields'
}
function useRecipeFormGuard(pending: boolean, state: RecipeActionState) {
  const [dirty, setDirty] = useState(false)
  useNavigationGuard(() => ({ dirty, pending }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  useEffect(() => {
    if (state.ok) setDirty(false)
  }, [state])
  return () => setDirty(true)
}
function Feedback({ state }: { state: RecipeActionState }) {
  return state.message ? (
    <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`} role={state.ok ? 'status' : 'alert'}>
      {state.message}
    </p>
  ) : null
}
function Identity({ siteId, recipe }: { siteId: string; recipe?: PageRecipe }) {
  return (
    <>
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="recipeId" value={recipe?.id ?? ''} />
      <input type="hidden" name="revision" value={recipe?.revision ?? '0'} />
    </>
  )
}
function RecipePreview({ recipe, siteId }: { recipe: PageRecipe; siteId: string }) {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(1200)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])
  return (
    <>
      <button type="button" className="secondary small" onClick={() => setOpen(true)}>
        Preview
      </button>
      {open && (
        <dialog
          className="section-preview-dialog"
          ref={dialog}
          aria-label={`Preview ${recipe.name}`}
          onClose={() => setOpen(false)}
        >
          <div className="section-preview-dialog-head">
            <h2>{recipe.name}</h2>
            <button type="button" className="secondary small" autoFocus onClick={() => dialog.current?.close()}>
              Close preview
            </button>
          </div>
          <p className="hint">
            Chosen samples with saved site design. Collection records appear when you preview the new page; they are not
            copied into the template.
          </p>
          <div className="group" role="group" aria-label="Template preview width">
            {[
              [1200, 'Desktop'],
              [800, 'Tablet'],
              [390, 'Phone'],
            ].map(([value, label]) => (
              <button
                type="button"
                className="secondary small"
                key={value}
                aria-pressed={width === value}
                onClick={() => setWidth(Number(value))}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="section-live-preview-scroll">
            <ScriptlessPreview
              title={`Preview ${recipe.name}`}
              style={{ width, height: 620 }}
              src={`/api/recipes/${recipe.id}/preview?version=${recipe.current_version_id}&site=${siteId}`}
            />
          </div>
        </dialog>
      )}
    </>
  )
}

function CaptureRecipe({
  siteId,
  pages,
  names,
  recipe,
}: {
  siteId: string
  pages: RecipeSource[]
  names: Record<string, string>
  recipe?: PageRecipe
}) {
  const [state, action, pending] = useActionState(changeRecipe, initial)
  const [sourceId, setSourceId] = useState('')
  const [selection, setSelection] = useState<{ index: number; sample: boolean }[]>([])
  const [name, setName] = useState(recipe?.name ?? '')
  const dirty = Boolean(sourceId) || name !== (recipe?.name ?? '')
  useNavigationGuard(() => ({ dirty, pending }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  useEffect(() => {
    if (state.ok) {
      setSourceId('')
      setSelection([])
      setName(recipe?.name ?? '')
    }
  }, [state, recipe?.name])
  const source = pages.find(page => page.id === sourceId)
  const prefix = recipe?.id ?? 'new'
  function move(index: number, offset: number) {
    setSelection(current => {
      const next = [...current]
      const target = index + offset
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }
  return (
    <form action={action}>
      <fieldset disabled={pending} className={styles.form}>
        <Identity siteId={siteId} recipe={recipe} />
        <input type="hidden" name="command" value="save" />
        <input type="hidden" name="sourceVersion" value={source?.draft_version_id ?? ''} />
        <input type="hidden" name="selection" value={JSON.stringify(selection)} />
        <div className="field">
          <label htmlFor={`${prefix}-name`}>Template name</label>
          <input
            type="text"
            id={`${prefix}-name`}
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Conference overview"
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-source`}>Start from a saved page</label>
          <select
            id={`${prefix}-source`}
            value={sourceId}
            required
            onChange={event => {
              const page = pages.find(p => p.id === event.target.value)
              setSourceId(event.target.value)
              setSelection(page?.content.map((_, index) => ({ index, sample: false })) ?? [])
            }}
          >
            <option value="">Choose a page</option>
            {pages
              .filter(page => page.content.length > 0)
              .map(page => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
          </select>
          <p className="hint">
            Save the source page first. Page address, SEO, publishing state and history are excluded. Custom HTML/CSS
            sections must become governed definitions first.
          </p>
        </div>
        {source && (
          <>
            <a
              href={`/preview/${source.draft_version_id}?readonly=1&site=draft`}
              target="_blank"
              rel="noopener"
              className="btn secondary small"
            >
              Inspect saved source
            </a>
            <p className="hint">
              Arrange the sections below. Choose which text, images and links are suitable samples. This site’s
              collection bindings stay connected; their records are never copied.
            </p>
            <ol className={styles.outline}>
              {selection.map((choice, position) => {
                const section = source.content[choice.index]!
                return (
                  <li key={`${choice.index}-${position}`}>
                    <strong>{section.label || names[section.section_def_id] || 'Section'}</strong>
                    <span className="hint"> · version {section.section_def_version}</span>
                    <div className={styles.controls}>
                      <label>
                        <input
                          type="checkbox"
                          checked={choice.sample}
                          onChange={event =>
                            setSelection(current =>
                              current.map((item, i) =>
                                i === position ? { ...item, sample: event.target.checked } : item,
                              ),
                            )
                          }
                        />{' '}
                        Include this section’s sample content
                      </label>
                      <button
                        type="button"
                        className="secondary small"
                        disabled={position === 0}
                        onClick={() => move(position, -1)}
                        aria-label={`Move section ${position + 1} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="secondary small"
                        disabled={position === selection.length - 1}
                        onClick={() => move(position, 1)}
                        aria-label={`Move section ${position + 1} down`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => setSelection(current => current.filter((_, i) => i !== position))}
                      >
                        Remove
                      </button>
                    </div>
                    {choice.sample && (
                      <p className={styles.sample}>
                        {Object.values(section.values)
                          .map(value =>
                            typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ') : JSON.stringify(value),
                          )
                          .join(' · ')
                          .slice(0, 350) || 'No sample values in this section.'}
                      </p>
                    )}
                  </li>
                )
              })}
            </ol>
            <button
              type="button"
              className="secondary small"
              onClick={() => setSelection(source.content.map((_, index) => ({ index, sample: false })))}
            >
              Reset to source order
            </button>
          </>
        )}
        <Feedback state={state} />
        <button type="submit" disabled={pending || selection.length === 0}>
          {pending ? 'Saving…' : recipe ? 'Save updated template' : 'Save template'}
        </button>
      </fieldset>
    </form>
  )
}

function UseRecipe({ siteId, recipe, targets }: { siteId: string; recipe: PageRecipe; targets: RecipeTarget[] }) {
  const [state, action, pending] = useActionState(changeRecipe, initial)
  const markDirty = useRecipeFormGuard(pending, state)
  const [targetSiteId, setTargetSiteId] = useState(siteId)
  const targetSite = targets.find(target => target.id === targetSiteId)
  const [target, setTarget] = useState(
    targets.find(item => item.id === siteId)?.canCreate
      ? ''
      : (targets.find(item => item.id === siteId)?.pages[0]?.id ?? ''),
  )
  const [bindings, setBindings] = useState<RecipeBindings>({})
  const page = targetSite?.pages.find(p => p.id === target)
  const prefix = `${recipe.id}-use`
  if (!targetSite) return <p className="notice">No active destination site is available.</p>
  const canManage = targetSite.canCreate
  return (
    <form action={action} onChange={markDirty}>
      <fieldset disabled={pending} className={styles.form}>
        <Identity siteId={siteId} recipe={recipe} />
        <input type="hidden" name="command" value="use" />
        <input type="hidden" name="pageRevision" value={page?.revision ?? ''} />
        <input type="hidden" name="bindings" value={JSON.stringify(bindings)} />
        <div className="field">
          <label htmlFor={`${prefix}-site`}>Destination site</label>
          <select
            id={`${prefix}-site`}
            name="targetSite"
            value={targetSiteId}
            onChange={event => {
              const next = targets.find(item => item.id === event.target.value)
              setTargetSiteId(event.target.value)
              setTarget(next?.canCreate ? '' : (next?.pages[0]?.id ?? ''))
              setBindings({})
            }}
          >
            {targets.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={prefix}>Use template in</label>
          <select id={prefix} name="pageId" value={target} onChange={event => setTarget(event.target.value)}>
            {canManage && <option value="">A new draft page</option>}
            {targetSite.pages.map(p => (
              <option key={p.id} value={p.id}>
                {p.title} — append sections
              </option>
            ))}
          </select>
        </div>
        <RecipeBindingFields
          prefix={prefix}
          requirements={recipeBindingRequirements(recipe.content)}
          target={targetSite}
          required={recipe.scope === 'global' || recipe.site_id !== targetSiteId}
          bindings={bindings}
          onChange={setBindings}
        />
        {recipe.site_id !== targetSiteId && (
          <p className="hint">
            Cross-site reuse requires shared definitions and media. Site-owned assets are refused; replace them with
            shared assets in the template first.
          </p>
        )}
        {!target && canManage ? (
          <>
            <div className="field">
              <label htmlFor={`${prefix}-title`}>New page name</label>
              <input type="text" id={`${prefix}-title`} name="title" required maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-slug`}>Page address</label>
              <input
                type="text"
                id={`${prefix}-slug`}
                name="slug"
                maxLength={160}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="conference-2027"
              />
              <p className="hint">Lowercase words separated by hyphens. Leave empty only for the home page.</p>
            </div>
          </>
        ) : (
          page && (
            <label className={styles.confirm}>
              <input type="checkbox" name="savedOnlyConfirmed" required /> I have saved my work on “{page.title}”,
              including in other tabs. Add these sections after its saved content.
            </label>
          )
        )}
        <p className="hint">
          Creates a private checkpoint. Existing sections and page settings stay intact. Nothing is published.
        </p>
        <Feedback state={state} />
        <button type="submit" disabled={pending || (!canManage && !page)}>
          {pending ? 'Creating draft…' : target ? 'Add sections & edit page' : 'Create draft & edit page'}
        </button>
      </fieldset>
    </form>
  )
}

function ShareRecipe({ siteId, recipe }: { siteId: string; recipe: PageRecipe }) {
  const [state, action, pending] = useActionState(changeRecipe, initial)
  const markDirty = useRecipeFormGuard(pending, state)
  return (
    <form action={action} onChange={markDirty}>
      <fieldset disabled={pending} className={styles.form}>
        <Identity siteId={siteId} recipe={recipe} />
        <input type="hidden" name="command" value="share" />
        <div className="field">
          <label htmlFor={`${recipe.id}-share-name`}>Shared starter name</label>
          <input
            type="text"
            id={`${recipe.id}-share-name`}
            name="name"
            defaultValue={`${recipe.name} starter`.slice(0, 120)}
            required
            maxLength={120}
          />
        </div>
        <p className="hint">
          Creates a new starter available across sites. Only shared definitions and shared images are permitted. Site
          documents and private record selections are excluded. Each site must connect its own collections.
        </p>
        <Feedback state={state} />
        <button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create shared starter'}
        </button>
      </fieldset>
    </form>
  )
}

function ManageRecipe({ siteId, recipe }: { siteId: string; recipe: PageRecipe }) {
  const [state, action, pending] = useActionState(changeRecipe, initial)
  const markDirty = useRecipeFormGuard(pending, state)
  return (
    <form action={action} onChange={markDirty}>
      <fieldset disabled={pending} className={styles.form}>
        <Identity siteId={siteId} recipe={recipe} />
        <div className="field">
          <label htmlFor={`${recipe.id}-rename`}>Template name</label>
          <input
            type="text"
            id={`${recipe.id}-rename`}
            name="name"
            defaultValue={recipe.name}
            required
            maxLength={120}
          />
        </div>
        <p className="hint">
          Retiring removes a template from new uses. Existing pages and earlier template versions stay intact.
        </p>
        <Feedback state={state} />
        <div className={styles.controls}>
          <button name="command" value={recipe.retired_at ? 'restore' : 'rename'} disabled={pending}>
            {recipe.retired_at ? 'Restore template' : 'Rename template'}
          </button>
          {!recipe.retired_at && (
            <button className="secondary" name="command" value="retire" disabled={pending}>
              Retire template
            </button>
          )}
        </div>
      </fieldset>
    </form>
  )
}

export function RecipesWorkspace({
  siteId,
  recipes,
  pages,
  names,
  canManage,
  isSuperAdmin,
  targets,
}: {
  siteId: string
  recipes: PageRecipe[]
  pages: RecipeSource[]
  names: Record<string, string>
  canManage: boolean
  isSuperAdmin: boolean
  targets: RecipeTarget[]
}) {
  const [task, setTask] = useState<string | null>(null)
  function toggleTask(next: string) {
    if (!confirmClientNavigation()) return
    setTask(current => (current === next ? null : next))
  }
  return (
    <div className={styles.workspace}>
      {canManage && (
        <details open={task === 'new'} className={`card ${styles.panel}`}>
          <summary
            onClick={event => {
              event.preventDefault()
              toggleTask('new')
            }}
          >
            Save a page as a template
          </summary>
          {task === 'new' && <CaptureRecipe siteId={siteId} pages={pages} names={names} />}
        </details>
      )}
      {recipes.length === 0 && (
        <div className="empty-state">
          <h2>No templates yet</h2>
          <p>
            {canManage
              ? 'Arrange and save a page, then save its reusable structure here.'
              : 'An editor can save a page template for this site. You can then add its sections to an existing page.'}
          </p>
          <Link href={`/sites/${siteId}`} className="btn secondary">
            Open pages
          </Link>
        </div>
      )}
      <div className={styles.grid}>
        {recipes.map(recipe => (
          <article key={`${recipe.id}-${recipe.revision}`} className={`card ${styles.panel}`}>
            <div className={styles.controls}>
              <h2>{recipe.name}</h2>
              {recipe.retired_at && <span className="chip chip-neutral">Retired</span>}
            </div>
            <p className="hint">
              {recipe.content.length} sections · {recipe.scope === 'global' ? 'Shared starter' : 'Site template'} ·
              Saved version
            </p>
            <ol className={styles.outline}>
              {recipe.content.map((section, index) => (
                <li key={index}>
                  {section.label || names[section.section_def_id] || 'Section'}{' '}
                  <span className="hint">
                    v{section.section_def_version} · {valueLabel(section)}
                  </span>
                </li>
              ))}
            </ol>
            <RecipePreview recipe={recipe} siteId={siteId} />
            {!recipe.retired_at && (
              <details open={task === `${recipe.id}-use`} className={styles.details}>
                <summary
                  onClick={event => {
                    event.preventDefault()
                    toggleTask(`${recipe.id}-use`)
                  }}
                >
                  Use this template
                </summary>
                {task === `${recipe.id}-use` && <UseRecipe siteId={siteId} recipe={recipe} targets={targets} />}
              </details>
            )}
            {(recipe.scope === 'global' ? isSuperAdmin : canManage) && (
              <>
                <details open={task === `${recipe.id}-manage`} className={styles.details}>
                  <summary
                    onClick={event => {
                      event.preventDefault()
                      toggleTask(`${recipe.id}-manage`)
                    }}
                  >
                    Rename or {recipe.retired_at ? 'restore' : 'retire'}
                  </summary>
                  {task === `${recipe.id}-manage` && <ManageRecipe siteId={siteId} recipe={recipe} />}
                </details>
                {!recipe.retired_at && recipe.site_id === siteId && (
                  <details open={task === `${recipe.id}-update`} className={styles.details}>
                    <summary
                      onClick={event => {
                        event.preventDefault()
                        toggleTask(`${recipe.id}-update`)
                      }}
                    >
                      Update composition from a saved page
                    </summary>
                    {task === `${recipe.id}-update` && (
                      <CaptureRecipe siteId={siteId} recipe={recipe} pages={pages} names={names} />
                    )}
                  </details>
                )}
                {recipe.scope === 'global' && recipe.site_id !== siteId && (
                  <p className="hint">
                    <Link href={`/sites/${recipe.site_id}/recipes`}>Update this starter in its authoring site</Link>
                  </p>
                )}
              </>
            )}
            {isSuperAdmin && recipe.scope === 'site' && !recipe.retired_at && (
              <details open={task === `${recipe.id}-share`} className={styles.details}>
                <summary
                  onClick={event => {
                    event.preventDefault()
                    toggleTask(`${recipe.id}-share`)
                  }}
                >
                  Create a shared starter
                </summary>
                {task === `${recipe.id}-share` && <ShareRecipe siteId={siteId} recipe={recipe} />}
              </details>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
