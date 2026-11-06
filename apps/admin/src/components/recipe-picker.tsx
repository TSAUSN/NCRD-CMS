'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { loadRecipePicker, prepareRecipeInsertion } from '../app/sites/[siteId]/recipes/picker-actions.ts'
import { recipeBindingRequirements, type RecipeBindings } from '../lib/recipe-reuse-model.ts'
import { RecipeBindingFields } from './recipe-bindings.tsx'
import { GuardedLink as Link } from './guarded-link.tsx'
import { ScriptlessPreview } from './scriptless-preview.tsx'
import { useNavigationGuard } from './navigation-guard.ts'
import styles from './recipe-picker.module.css'

export type PreparedRecipeInsertion = Extract<Awaited<ReturnType<typeof prepareRecipeInsertion>>, { ok: true }>
type Loaded = NonNullable<Awaited<ReturnType<typeof loadRecipePicker>>>
type Recipe = Loaded['recipes'][number]

/**
 * Page recipes in the docked library (V1 reference 12). Every recipe is a card
 * that names its sections in order, so one can be chosen at a glance rather
 * than from a list of names; one action adds them all at the chosen place, as a
 * single undoable edit of the working draft. A recipe from elsewhere asks for
 * its collections first.
 */
export function RecipePicker({
  siteId,
  onBegin,
  onInsert,
  allowedDefinitionIds,
}: {
  siteId: string
  allowedDefinitionIds?: readonly string[]
  /** Remembers where the sections will go, just before a recipe is checked. */
  onBegin: () => void
  onInsert: (prepared: PreparedRecipeInsertion) => string | null
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [failure, setFailure] = useState('')
  const [bindings, setBindings] = useState<Record<string, RecipeBindings>>({})
  const [message, setMessage] = useState<{ recipe: string; text: string } | null>(null)
  const [adding, setAdding] = useState('')
  const [pending, startTransition] = useTransition()
  const [previewing, setPreviewing] = useState<Recipe | null>(null)
  const [previewWidth, setPreviewWidth] = useState(1200)
  const preview = useRef<HTMLDialogElement>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const pathname = usePathname()
  const route = useRef(pathname)
  route.current = pathname
  useNavigationGuard(() => ({ dirty: false, pending: inFlight.current }))
  useEffect(() => {
    if (previewing) preview.current?.showModal()
  }, [previewing])
  useEffect(() => {
    const request = ++generation.current
    loadRecipePicker(siteId).then(
      loaded => {
        if (generation.current !== request) return
        setData(loaded)
        if (!loaded) setFailure('Templates are unavailable for this site.')
      },
      () => {
        if (generation.current === request)
          setFailure('Templates could not be loaded. Show the sections and come back to try again.')
      },
    )
    return () => {
      generation.current++
      inFlight.current = false
    }
  }, [siteId])

  function add(recipe: Recipe) {
    if (inFlight.current) return
    onBegin()
    inFlight.current = true
    setAdding(recipe.id)
    setMessage(null)
    const request = generation.current
    const requestedRoute = route.current
    startTransition(async () => {
      try {
        const prepared = await prepareRecipeInsertion(siteId, recipe.id, recipe.revision, bindings[recipe.id] ?? {})
        if (request !== generation.current || route.current !== requestedRoute) return
        if (!prepared.ok) {
          setMessage({ recipe: recipe.id, text: prepared.message })
          return
        }
        const refused = onInsert(prepared)
        if (refused) setMessage({ recipe: recipe.id, text: refused })
      } catch {
        if (request === generation.current)
          setMessage({
            recipe: recipe.id,
            text: 'The template could not be checked. Your page has not changed. Try again.',
          })
      } finally {
        if (request === generation.current) {
          inFlight.current = false
          setAdding('')
        }
      }
    })
  }

  const allowed = allowedDefinitionIds ? new Set(allowedDefinitionIds) : null,
    available =
      data?.recipes.filter(
        recipe => !allowed || recipe.content.every(section => allowed.has(section.section_def_id)),
      ) ?? []
  const previewSrc = previewing
    ? `/api/recipes/${previewing.id}/preview?version=${previewing.current_version_id}&site=${siteId}`
    : ''
  return (
    <section className={styles.root} data-recipe-picker aria-label="Insert a page template">
      <p className="hint">
        Each template adds a ready-made group of sections here, in order. Edit or reorder them afterwards; Undo removes
        the whole group in one step.
      </p>
      {!data && !failure && (
        <p role="status" className="hint">
          Loading templates…
        </p>
      )}
      {failure && (
        <p className="notice notice-error" role="alert">
          {failure}
        </p>
      )}
      {data &&
        available.length === 0 &&
        (allowed ? (
          <p className={styles.empty}>No saved templates fit this chapter page. Choose a section instead.</p>
        ) : (
          <p className={styles.empty}>
            No templates yet. Save a page as a template in this site’s{' '}
            <Link href={`/sites/${siteId}/recipes`}>Page templates</Link> workspace, and it will be offered here.
          </p>
        ))}
      {data && available.length > 0 && (
        <ul className={styles.list}>
          {available.map(recipe => {
            const requirements = recipeBindingRequirements(recipe.content)
            const required = recipe.scope === 'global' || recipe.site_id !== siteId
            const title = `recipe-card-${recipe.id}`
            return (
              <li key={recipe.id}>
                <form
                  className={styles.card}
                  aria-labelledby={title}
                  onSubmit={event => {
                    event.preventDefault()
                    add(recipe)
                  }}
                >
                  <div className={styles.cardHead}>
                    <h3 id={title}>{recipe.name}</h3>
                    <span className="chip chip-neutral">
                      {recipe.scope === 'global' ? 'Shared starter' : 'This site'}
                    </span>
                  </div>
                  <ol className={styles.sections} aria-label={`Sections in ${recipe.name}`}>
                    {recipe.content.map((section, index) => (
                      <li key={index}>
                        <span className={styles.number} aria-hidden="true">
                          {index + 1}
                        </span>
                        <span>{section.label || data.names[section.section_def_id] || 'Section'}</span>
                      </li>
                    ))}
                  </ol>
                  <fieldset disabled={pending} className={styles.fields}>
                    {requirements.length > 0 && (
                      <details open={required} className={styles.collections}>
                        <summary>{required ? 'Choose its collections' : 'Connected collections'}</summary>
                        <RecipeBindingFields
                          prefix={title}
                          requirements={requirements}
                          target={data.target}
                          required={required}
                          bindings={bindings[recipe.id] ?? {}}
                          onChange={next => setBindings(previous => ({ ...previous, [recipe.id]: next }))}
                        />
                        <p className="hint">
                          The preview shows stored samples; connected records appear in your page canvas.
                        </p>
                      </details>
                    )}
                    <div className={styles.actions}>
                      <button type="button" className="secondary small" onClick={() => setPreviewing(recipe)}>
                        Preview
                      </button>
                      <button type="submit" className="secondary small">
                        {adding === recipe.id ? 'Checking template…' : 'Add these sections'}
                      </button>
                    </div>
                  </fieldset>
                  {message?.recipe === recipe.id && (
                    <p className="notice notice-error" role="alert">
                      {message.text}
                    </p>
                  )}
                </form>
              </li>
            )
          })}
        </ul>
      )}
      {previewing && (
        <dialog
          ref={preview}
          className="section-preview-dialog"
          aria-label={`Template preview: ${previewing.name}`}
          onClose={() => setPreviewing(null)}
        >
          <div className="section-preview-dialog-head">
            <h2>{previewing.name}</h2>
            <button type="button" className="secondary small" autoFocus onClick={() => preview.current?.close()}>
              Close preview
            </button>
          </div>
          <div className="group" role="group" aria-label="Template preview width">
            {[
              [1200, 'Desktop'],
              [800, 'Tablet'],
              [390, 'Phone'],
            ].map(([width, label]) => (
              <button
                type="button"
                key={width}
                className="secondary small"
                aria-pressed={previewWidth === width}
                onClick={() => setPreviewWidth(Number(width))}
              >
                {label}
              </button>
            ))}
          </div>
          <ScriptlessPreview
            title="Full template preview"
            src={previewSrc}
            style={{ width: previewWidth, height: 560 }}
          />
        </dialog>
      )}
    </section>
  )
}
