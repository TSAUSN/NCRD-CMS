'use client'
// The page creator is a small planning workspace, not a two-field disclosure.
//
// V1 proved that people understand a page as an ordered stack of sections. The
// old V2 form asked for a title and an address, then dropped somebody onto an
// empty canvas and made them discover the library afterwards. This keeps the
// quick path, but lets the person choose and order the starting structure while
// the consequence is still cheap to understand.
import styles from './new-page.module.css'
import shared from '../../../components/workspace.module.css'
import { useRouter } from 'next/navigation'
import { Button, Field, SegmentedControl } from '../../../components/ui/index.ts'
import { duplicatePageAction } from '../../pages/[pageId]/page-copy-actions.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CORE_PAGE_TEMPLATES, coreTemplateSectionOptions } from '@cms/seeds/core-templates'
import { createPage } from '../../actions/page-lifecycle.ts'
import {
  IconAlert,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconClose,
  IconPage,
  IconPlus,
  IconSearch,
  IconSections,
  IconTrash,
} from '../../../components/icons.tsx'
import { SectionThumbnail } from '../../../components/section-thumbnail.tsx'
import type { LibraryEntry } from '../../../lib/queries.ts'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_STARTER_SECTIONS = 12
type StartMode = 'starter' | 'blank' | 'custom'

function templateSectionIds(library: LibraryEntry[], templateId: string): string[] {
  const template = CORE_PAGE_TEMPLATES.find(template => template.id === templateId)
  return (
    template?.sections.flatMap(slug => {
      const section = library.find(entry => entry.slug === `core-${slug}`)
      return section ? [section.section_def_id] : []
    }) ?? []
  )
}

function CreateButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={disabled || pending}>
      <IconPage size={16} /> {pending ? 'Creating the page…' : 'Create this page'}
    </button>
  )
}

export function NewPageForm({
  siteId,
  siteName,
  siteAddress,
  library,
  prompt,
  primary = false,
  pages = [],
  designs = [],
}: {
  siteId: string
  siteName: string
  siteAddress: string
  library: LibraryEntry[]
  pages?: { id: string; title: string; revision: string }[]
  designs?: { id: string; title: string; revision: string }[]
  primary?: boolean
  prompt?: boolean
}) {
  const router = useRouter()
  const [copyMode, setCopyMode] = useState(false),
    [designId, setDesignId] = useState(designs[0]?.id ?? '')
  const [copyId, setCopyId] = useState(''),
    [copyPending, setCopyPending] = useState(false),
    [copyError, setCopyError] = useState<string | null>(null)
  async function copy(sourceId = copyId) {
    const page = pages.find(page => page.id === sourceId)
    if (!page || copyPending) return
    setCopyPending(true)
    setCopyError(null)
    try {
      const result = await duplicatePageAction(page.id, Number(page.revision), { title, address: effective })
      if (result.ok) router.push('/pages/' + result.pageId)
      else setCopyError(result.message)
    } catch {
      setCopyError('The copy could not be confirmed. Check Pages before trying again.')
    } finally {
      setCopyPending(false)
    }
  }
  const recommended = useMemo(() => templateSectionIds(library, 'landing'), [library])
  const [pageTemplate, setPageTemplate] = useState('landing')
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [touchedSlug, setTouchedSlug] = useState(false)
  const [mode, setMode] = useState<StartMode>(library.length > 0 ? 'starter' : 'blank')
  const [selectedIds, setSelectedIds] = useState<string[]>(recommended)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  const suggested = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const effective = touchedSlug ? slug : suggested
  const slugProblem =
    effective !== '' && !SLUG.test(effective)
      ? 'Use lowercase letters, numbers and hyphens — for example about-us.'
      : null

  const entries = useMemo(() => new Map(library.map(entry => [entry.section_def_id, entry])), [library])
  const selected = selectedIds.flatMap(id => {
    const entry = entries.get(id)
    if (!entry) return []
    const options = coreTemplateSectionOptions(pageTemplate, entry.slug ?? '')
    return [{ ...entry, name: options?.label ?? entry.name, startsHidden: options?.hidden ?? false }]
  })
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of library) {
      const name = entry.category || 'Other'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [library])
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return library.filter(entry => {
      if (category && (entry.category || 'Other') !== category) return false
      if (!term) return true
      return `${entry.name} ${entry.slug} ${entry.category}`.toLowerCase().includes(term)
    })
  }, [library, search, category])

  function close() {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  function chooseMode(next: StartMode) {
    setMode(next)
    if (next === 'blank') {
      setPageTemplate('blank')
      setSelectedIds(templateSectionIds(library, 'blank'))
    }
    if (next === 'starter') {
      const id = pageTemplate === 'blank' ? 'landing' : pageTemplate
      setPageTemplate(id)
      setSelectedIds(templateSectionIds(library, id))
    }
    if (next === 'custom' && mode === 'blank') setSelectedIds([])
  }

  function toggleSection(id: string) {
    setMode('custom')
    setSelectedIds(current => {
      if (current.includes(id)) return current.filter(candidate => candidate !== id)
      if (current.length >= MAX_STARTER_SECTIONS) return current
      return [...current, id]
    })
  }

  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= selectedIds.length) return
    setMode('custom')
    setSelectedIds(current => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }

  useEffect(() => {
    if (open) titleInput.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <>
      <Button
        ref={trigger}
        variant={prompt || primary ? 'primary' : 'secondary'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <IconPlus size={15} /> Add a page
      </Button>

      {open && (
        <div
          className="page-creator-overlay"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div
            ref={dialog}
            className={`page-creator ${styles.creator} ${shared.planner}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="page-creator-title"
          >
            <header className={'page-creator-head ' + shared.plannerHead}>
              <div>
                <p className="eyebrow">{siteName}</p>
                <h2 id="page-creator-title">Create a page</h2>
                <p>It starts as a private draft. Nobody sees it until you publish.</p>
              </div>
              <button
                type="button"
                className="icon-btn tip tip-right"
                data-tip="Close (Esc)"
                aria-label="Close page creator"
                onClick={close}
              >
                <IconClose size={19} />
              </button>
            </header>

            <form
              action={createPage}
              onSubmit={event => {
                if (copyMode || (designId && mode !== 'blank' && mode !== 'custom')) {
                  event.preventDefault()
                  void copy(copyMode ? copyId : designId)
                }
              }}
            >
              <input type="hidden" name="siteId" value={siteId} />
              {mode !== 'custom' && (
                <input type="hidden" name="pageTemplate" value={mode === 'blank' ? 'blank' : pageTemplate} />
              )}
              {mode === 'custom' && pageTemplate === 'chapter' && (
                <input type="hidden" name="sourceTemplate" value="chapter" />
              )}
              {selectedIds.map(id => (
                <input key={id} type="hidden" name="sectionDefId" value={id} />
              ))}

              <div className={'page-creator-body ' + shared.plannerBody}>
                <div className={'page-creator-main ' + shared.plannerMain}>
                  <section className={'creator-block ' + shared.plannerBlock} aria-labelledby="page-details-title">
                    <div className="creator-block-head">
                      <span className="creator-step">1</span>
                      <div>
                        <h3 id="page-details-title">Page details</h3>
                        <p>You can change the title later. The address should stay memorable.</p>
                      </div>
                    </div>
                    <div className="row2">
                      <div className="field">
                        <label htmlFor="page-title">What is this page called?</label>
                        <input
                          ref={titleInput}
                          id="page-title"
                          name="title"
                          type="text"
                          required
                          value={title}
                          onChange={event => setTitle(event.target.value)}
                          placeholder="About us"
                        />
                        <p className="hint">People see this in the browser tab and search results.</p>
                      </div>
                      <div className="field">
                        <label htmlFor="page-slug">Web address</label>
                        <input
                          id="page-slug"
                          name="slug"
                          type="text"
                          value={effective}
                          onChange={event => {
                            setTouchedSlug(true)
                            setSlug(event.target.value)
                          }}
                          placeholder="about-us"
                          aria-describedby={
                            slugProblem ? 'page-address-preview page-slug-problem' : 'page-address-preview'
                          }
                        />
                        <p className="address-preview mono" id="page-address-preview">
                          {siteAddress}/{effective}
                        </p>
                        {slugProblem && (
                          <p className="error-inline" id="page-slug-problem">
                            {slugProblem}
                          </p>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className={'creator-block ' + shared.plannerBlock} aria-labelledby="page-start-title">
                    <div className="creator-block-head">
                      <span className="creator-step">2</span>
                      <div>
                        <h3 id="page-start-title">Choose a starting point</h3>
                        <p>A starter saves setup time. You can move, hide, or remove its sections.</p>
                      </div>
                    </div>

                    <SegmentedControl
                      label="Start from"
                      value={copyMode ? 'copy' : mode === 'blank' ? 'blank' : 'template'}
                      options={[
                        { value: 'template', label: 'A template' },
                        ...(pages.length ? [{ value: 'copy', label: 'Copy of a page' }] : []),
                        { value: 'blank', label: 'Blank page' },
                      ]}
                      onChange={value => {
                        setCopyMode(value === 'copy')
                        setDesignId(value === 'template' ? (designs[0]?.id ?? '') : '')
                        chooseMode(value === 'blank' ? 'blank' : 'starter')
                      }}
                    />
                    {copyMode ? (
                      <div className={shared.stack}>
                        <p>The copy keeps the sections and their settings, and starts as a private draft.</p>
                        <Field id="copy-source" label="Page to copy">
                          <select
                            value={copyId}
                            disabled={copyPending}
                            onChange={event => setCopyId(event.target.value)}
                          >
                            <option value="">Choose a page…</option>
                            {pages.map(page => (
                              <option key={page.id} value={page.id}>
                                {page.title}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    ) : designs.length > 0 && mode !== 'blank' && mode !== 'custom' ? (
                      <>
                        <div className={shared.optionGrid} aria-label="SAWSO page designs">
                          {designs.map(design => {
                            const preview = library.find(entry => entry.slug === 'core-page-header')
                            return (
                              <button
                                type="button"
                                key={design.id}
                                className={shared.optionCard}
                                aria-pressed={designId === design.id}
                                onClick={() => setDesignId(design.id)}
                              >
                                {preview && <SectionThumbnail entry={preview} element="span" eager />}
                                <strong>{design.title}</strong>
                                <small>Existing SAWSO page design</small>
                              </button>
                            )
                          })}
                        </div>
                        <p className="hint">
                          These designs copy existing pages in this site's look. Story pages are created in Stories.
                        </p>
                        <Button
                          variant="tertiary"
                          onClick={() => {
                            setDesignId('')
                            chooseMode('custom')
                          }}
                        >
                          Choose sections
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="field">
                          <label htmlFor="page-template">Page template</label>
                          <select
                            id="page-template"
                            value={pageTemplate}
                            onChange={event => {
                              setPageTemplate(event.target.value)
                              setSelectedIds(templateSectionIds(library, event.target.value))
                              setMode(event.target.value === 'blank' ? 'blank' : 'starter')
                            }}
                          >
                            {CORE_PAGE_TEMPLATES.map(template => (
                              <option key={template.id} value={template.id}>
                                {template.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className={shared.optionGrid} aria-label="Template previews">
                          {CORE_PAGE_TEMPLATES.filter(template =>
                            ['landing', 'resources', 'event-home'].includes(template.id),
                          ).map(template => {
                            const first = library.find(entry => entry.slug === 'core-' + template.sections[0])
                            return (
                              <button
                                key={template.id}
                                type="button"
                                className={shared.optionCard}
                                aria-pressed={pageTemplate === template.id}
                                onClick={() => {
                                  setPageTemplate(template.id)
                                  setSelectedIds(templateSectionIds(library, template.id))
                                  setMode(template.id === 'blank' ? 'blank' : 'starter')
                                }}
                              >
                                {first && <SectionThumbnail entry={first} element="span" eager />}
                                <strong>{template.name}</strong>
                                <small>
                                  {template.sections.length} {template.sections.length === 1 ? 'section' : 'sections'}
                                </small>
                              </button>
                            )
                          })}
                        </div>
                        <div className="page-start-options" role="group" aria-label="Page starting point">
                          <button
                            type="button"
                            className={mode === 'starter' ? 'selected' : ''}
                            aria-pressed={mode === 'starter'}
                            disabled={recommended.length === 0}
                            onClick={() => chooseMode('starter')}
                          >
                            <IconSections size={20} />
                            <span>
                              <strong>Starter page</strong>
                              <small>Recommended · a useful page rhythm</small>
                            </span>
                            {mode === 'starter' && <IconCheck size={17} />}
                          </button>
                          <button
                            type="button"
                            className={mode === 'custom' ? 'selected' : ''}
                            aria-pressed={mode === 'custom'}
                            disabled={library.length === 0}
                            onClick={() => chooseMode('custom')}
                          >
                            <IconPlus size={20} />
                            <span>
                              <strong>Choose sections</strong>
                              <small>Build the outline yourself</small>
                            </span>
                            {mode === 'custom' && <IconCheck size={17} />}
                          </button>
                        </div>

                        {mode === 'blank' ? (
                          <div className="creator-blank">
                            <IconPage size={24} />
                            <div>
                              <strong>A simple page header</strong>
                              <p>
                                Your title and introduction are ready to edit. Add more sections when you need them.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <details className={shared.plannerDisclosure} open={mode === 'custom'}>
                            <summary>Choose and arrange starting sections</summary>
                            <div className="creator-library">
                              <div className="creator-library-tools">
                                <label className="search-field" htmlFor="creator-section-search">
                                  <IconSearch size={15} />
                                  <span className="sr-only">Search sections</span>
                                  <input
                                    id="creator-section-search"
                                    type="search"
                                    placeholder="Search sections"
                                    value={search}
                                    onChange={event => setSearch(event.target.value)}
                                  />
                                </label>
                                <span className="hint">Choose up to {MAX_STARTER_SECTIONS}</span>
                              </div>
                              <div className="creator-category-row" aria-label="Filter sections by category">
                                <button
                                  type="button"
                                  aria-pressed={category === null}
                                  onClick={() => setCategory(null)}
                                >
                                  All <span>{library.length}</span>
                                </button>
                                {categories.map(([name, count]) => (
                                  <button
                                    key={name}
                                    type="button"
                                    aria-pressed={category === name}
                                    onClick={() => setCategory(name)}
                                  >
                                    {name} <span>{count}</span>
                                  </button>
                                ))}
                              </div>
                              {shown.length === 0 ? (
                                <div className="creator-blank">
                                  <IconSearch size={22} />
                                  <div>
                                    <strong>No matching sections</strong>
                                    <p>Clear the search or choose another category.</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="creator-section-grid">
                                  {shown.map(entry => {
                                    const added = selectedIds.includes(entry.section_def_id)
                                    return (
                                      <button
                                        key={entry.section_def_id}
                                        type="button"
                                        className={added ? 'added' : ''}
                                        aria-pressed={added}
                                        onClick={() => toggleSection(entry.section_def_id)}
                                      >
                                        <SectionThumbnail entry={entry} element="span" eager />
                                        <span className="creator-section-copy">
                                          <strong>{entry.name}</strong>
                                          <small>
                                            {entry.category || 'Other'} · {entry.slots.length} editable{' '}
                                            {entry.slots.length === 1 ? 'field' : 'fields'}
                                          </small>
                                        </span>
                                        <span className="creator-section-action">
                                          {added ? (
                                            <>
                                              <IconCheck size={14} /> Added
                                            </>
                                          ) : (
                                            <>
                                              <IconPlus size={14} /> Add
                                            </>
                                          )}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                              {selectedIds.length >= MAX_STARTER_SECTIONS && (
                                <p className="notice notice-warn">
                                  <IconAlert size={15} /> Start with at most {MAX_STARTER_SECTIONS} sections; you can
                                  add more in the editor.
                                </p>
                              )}
                            </div>
                          </details>
                        )}
                      </>
                    )}
                    {copyError && <p role="alert">{copyError}</p>}
                  </section>
                </div>

                {!copyMode && !designId && (
                  <details className={shared.plannerDisclosure} open={mode === 'custom'}>
                    <summary>Starting structure</summary>
                    <aside className={'page-outline ' + shared.plannerAside} aria-labelledby="page-outline-title">
                      <div className="page-outline-head">
                        <div>
                          <p className="eyebrow">Starting structure</p>
                          <h3 id="page-outline-title">Page outline</h3>
                        </div>
                        <span className="tally">{selected.length}</span>
                      </div>
                      {selected.length === 0 ? (
                        <div className="page-outline-empty">
                          <IconPage size={22} />
                          <p>A Page header will keep your title visible. You can add more sections in the editor.</p>
                        </div>
                      ) : (
                        <ol>
                          {selected.map((entry, index) => (
                            <li key={entry.section_def_id}>
                              <span className="outline-index">{index + 1}</span>
                              <span className="outline-name">
                                <strong>{entry.name}</strong>
                                <small>
                                  {entry.startsHidden ? 'Starts hidden · ' : ''}
                                  {entry.category || 'Other'}
                                </small>
                              </span>
                              <span className="outline-actions">
                                <button
                                  type="button"
                                  className="icon-btn"
                                  disabled={index === 0}
                                  aria-label={`Move ${entry.name} up`}
                                  onClick={() => moveSection(index, -1)}
                                >
                                  <IconArrowUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  disabled={index === selected.length - 1}
                                  aria-label={`Move ${entry.name} down`}
                                  onClick={() => moveSection(index, 1)}
                                >
                                  <IconArrowDown size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn danger-quiet"
                                  aria-label={`Remove ${entry.name}`}
                                  onClick={() => toggleSection(entry.section_def_id)}
                                >
                                  <IconTrash size={14} />
                                </button>
                              </span>
                              {entry.carries_trusted_code && (
                                <span className="outline-warning">
                                  <IconAlert size={12} /> approval required
                                </span>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                      <div className="page-outline-note">
                        <IconCheck size={15} />
                        <p>The page starts as a draft. Creating it does not change the live site.</p>
                      </div>
                    </aside>
                  </details>
                )}
              </div>

              <footer className={'page-creator-foot ' + shared.plannerFoot}>
                <button type="button" className="ghost" onClick={close}>
                  Cancel
                </button>
                <span>You will go straight to the editor.</span>
                <CreateButton
                  disabled={title.trim() === '' || slugProblem !== null || copyPending || (copyMode && !copyId)}
                />
              </footer>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
