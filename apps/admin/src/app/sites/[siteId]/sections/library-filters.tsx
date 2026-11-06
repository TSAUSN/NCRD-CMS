'use client'

import Link from 'next/link'
import styles from './library-filters.module.css'
import { useEffect, useRef, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { IconSearch } from '../../../../components/icons.tsx'
import { sitePreviewLabel } from '../../../../lib/preview-context.ts'

/**
 * The section library's filters as one line, applied as they change (reference
 * 18), with the count and the preview choices on the line below. It is still an
 * ordinary GET form, so Enter, a bookmark or a page without JavaScript gives the
 * same filtered list; with JavaScript the list follows each choice, and typing
 * settles for a moment before the search runs.
 */
export function LibraryFilters({
  siteId,
  search,
  category,
  source,
  favourites,
  previewSite,
  previewContext,
  categories,
  sites,
  children,
}: {
  siteId: string
  search: string
  category: string
  source: string
  favourites: boolean
  previewSite: string
  previewContext: string
  categories: string[]
  sites: { id: string; name: string }[]
  /** The count and any “Clear filters” link, rendered by the page. */
  children: ReactNode
}) {
  const router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [pending, startTransition] = useTransition()
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // The controls are uncontrolled so typing is never interrupted by a refresh.
  // When the address changes from elsewhere (Clear filters, Back), bring every
  // control the person is not using back in line with it.
  useEffect(() => {
    const fields = form.current?.elements
    if (!fields) return
    const values: Record<string, string> = { q: search, category, source, previewSite, site: previewContext }
    for (const [name, value] of Object.entries(values)) {
      const field = fields.namedItem(name)
      if (
        (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) &&
        field !== document.activeElement &&
        field.value !== value
      )
        field.value = value
    }
    const box = fields.namedItem('favourites')
    if (box instanceof HTMLInputElement && box !== document.activeElement) box.checked = favourites
  }, [search, category, source, favourites, previewSite, previewContext])
  function apply(delay: number) {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (!form.current) return
      const params = new URLSearchParams()
      for (const [key, value] of new FormData(form.current)) {
        if (typeof value !== 'string' || !value.trim()) continue
        // Defaults stay out of the address, so a cleared filter is a clean URL.
        if ((key === 'previewSite' && value === siteId) || (key === 'site' && value === 'published')) continue
        params.set(key, value.trim())
      }
      const query = params.toString()
      startTransition(() => router.replace(`/sites/${siteId}/sections${query ? `?${query}` : ''}`, { scroll: false }))
    }, delay)
  }
  const changed = (event: { target: EventTarget }) =>
    apply(event.target instanceof HTMLInputElement && event.target.type === 'search' ? 300 : 0)
  return (
    <>
      <form
        ref={form}
        id="section-filters"
        method="get"
        action={`/sites/${siteId}/sections`}
        className="library-filters"
        aria-label="Filter sections"
        aria-busy={pending}
        onReset={() => window.clearTimeout(timer.current)}
        onSubmit={event => {
          event.preventDefault()
          apply(0)
        }}
        onChange={changed}
      >
        <div className="library-search">
          <label htmlFor="section-search" className="sr-only">
            Find a section
          </label>
          <IconSearch size={15} />
          <input
            id="section-search"
            type="search"
            name="q"
            defaultValue={search}
            maxLength={200}
            placeholder="Find a section by name or category"
          />
        </div>
        <select aria-label="Category" name="category" defaultValue={category}>
          <option value="">All categories</option>
          {categories.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="Source" name="source" defaultValue={source}>
          <option value="">All sources</option>
          <option value="global">Core</option>
          <option value="site">This site</option>
        </select>
        <label className="library-toggle">
          <input type="checkbox" name="favourites" value="1" defaultChecked={favourites} />
          <span aria-hidden="true">★</span> My favourites only
        </label>
        <button type="submit" className="sr-only">
          Apply filters
        </button>
      </form>
      <div className={`library-status ${styles.status}`}>
        {children}
        <div
          className="library-preview-as"
          role="group"
          aria-labelledby="section-preview-as"
          aria-describedby="section-preview-as-hint"
        >
          <span id="section-preview-as">Preview as</span>
          <select
            id="section-preview-site"
            form="section-filters"
            aria-label="Preview as site"
            name="previewSite"
            defaultValue={previewSite}
            onChange={changed}
          >
            {sites.map(candidate => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <select
            id="section-preview-context"
            form="section-filters"
            aria-label="Preview appearance"
            name="site"
            defaultValue={previewContext}
            onChange={changed}
          >
            {(['published', 'draft'] as const).map(value => (
              <option key={value} value={value}>
                {sitePreviewLabel(value)}
              </option>
            ))}
          </select>
          <span id="section-preview-as-hint" className="sr-only">
            Applied when you open a section’s preview. Only the section appears, using the selected site look. Unsaved
            changes are excluded.
          </span>
        </div>
      </div>
    </>
  )
}

/** Clear the visible fields immediately, before a following quick filter choice. */
export function LibraryResetLink({
  href,
  children,
  className,
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        const form = document.getElementById('section-filters')
        if (!(form instanceof HTMLFormElement)) return
        const appearance = ['previewSite', 'site'].map(name => {
          const field = form.elements.namedItem(name)
          return field instanceof HTMLSelectElement ? { field, value: field.value } : null
        })
        form.reset()
        for (const saved of appearance) if (saved) saved.field.value = saved.value
        for (const name of ['q', 'category', 'source']) {
          const field = form.elements.namedItem(name)
          if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = ''
        }
        const favourites = form.elements.namedItem('favourites')
        if (favourites instanceof HTMLInputElement) favourites.checked = false
      }}
    >
      {children}
    </Link>
  )
}
