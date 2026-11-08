'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { searchWorkspace } from '../app/command-search-actions.ts'
import { COMMAND_SEARCH_EVENT, isCommandSearchKey, type SearchResult } from '../lib/command-search-model.ts'
import { Dialog } from './ui/dialog.tsx'
import { Button } from './ui/button.tsx'
import { GuardedLink } from './guarded-link.tsx'
import styles from './command-search.module.css'
import { IconPage, IconCollection, IconPlus } from './icons.tsx'

export function CommandSearch() {
  const pathname = usePathname()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [active, setActive] = useState(0)
  const [retry, setRetry] = useState(0)
  const sequence = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const links = useRef<(HTMLAnchorElement | null)[]>([])
  function close() {
    sequence.current++
    setOpen(false)
    setQuery('')
    setResults([])
  }
  useEffect(() => {
    const show = () => {
      sequence.current++
      setQuery('')
      setResults([])
      setStatus('loading')
      setOpen(true)
    }
    const key = (event: KeyboardEvent) => {
      if (isCommandSearchKey(event)) {
        event.preventDefault()
        event.stopPropagation()
        show()
      }
    }
    window.addEventListener(COMMAND_SEARCH_EVENT, show)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener(COMMAND_SEARCH_EVENT, show)
      window.removeEventListener('keydown', key, true)
    }
  }, [])
  useEffect(close, [pathname])
  useEffect(() => {
    if (!open) return
    const request = ++sequence.current
    setResults([])
    setStatus('loading')
    setActive(0)
    const timer = window.setTimeout(() => {
      void searchWorkspace(query)
        .then(items => {
          if (sequence.current === request) {
            setResults(items)
            setStatus('ready')
          }
        })
        .catch(() => {
          if (sequence.current === request) setStatus('error')
        })
    }, 150)
    return () => {
      window.clearTimeout(timer)
      sequence.current++
    }
  }, [query, open, retry])
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  useEffect(() => {
    links.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, results])
  if (!open) return null
  return (
    <Dialog
      size="medium"
      title="Search or jump to"
      onClose={close}
      footer={
        <div className={styles.help}>
          <span>↑ ↓ move · Enter opens · Esc closes</span>
          <span>Only content you can access</span>
        </div>
      }
    >
      <div className={styles.search}>
        <label htmlFor={`${id}-query`}>Find a page, list item or action</label>
        <input
          ref={input}
          id={`${id}-query`}
          autoFocus
          maxLength={120}
          value={query}
          placeholder="Try a chapter, speaker or Settings"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded
          aria-controls={`${id}-results`}
          aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
          onChange={event => {
            sequence.current++
            setResults([])
            setQuery(event.target.value)
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const next = results.length
                ? (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length
                : 0
              setActive(next)
              links.current[next]?.scrollIntoView({ block: 'nearest' })
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              links.current[active]?.click()
            }
          }}
        />
        {status === 'loading' && <p role="status">Searching…</p>}
        {status === 'error' && (
          <div role="alert">
            <p>Couldn’t load results. Check your connection and try again.</p>
            <Button variant="secondary" onClick={() => setRetry(value => value + 1)}>
              Try again
            </Button>
          </div>
        )}
        {status === 'ready' && !results.length && <p role="status">No matches. Try another name or word.</p>}
        {status === 'ready' && results.length > 0 && (
          <p className={styles.resultSummary}>
            {results.length} {results.length === 1 ? 'result' : 'results'} · Scroll or use ↑ ↓ to see all
          </p>
        )}
        <div role="listbox" id={`${id}-results`} aria-label="Search results" className={styles.results}>
          {results.map((result, index) => (
            <div key={result.id}>
              {results[index - 1]?.group !== result.group && <h3>{result.group}</h3>}
              <GuardedLink
                role="option"
                aria-selected={active === index}
                id={`${id}-${index}`}
                ref={node => {
                  links.current[index] = node
                }}
                className={styles.result}
                href={result.href}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onDraftLeave={close}
                onNavigate={close}
              >
                <span className={styles.resultIcon} aria-hidden="true">
                  {result.group === 'Pages' ? (
                    <IconPage size={16} />
                  ) : result.group === 'List items' ? (
                    <IconCollection size={16} />
                  ) : (
                    <IconPlus size={16} />
                  )}
                </span>
                <span className={styles.resultCopy}>
                  <strong>{result.label}</strong>
                  <span>{result.detail}</span>
                </span>
                {active === index && (
                  <span className={styles.enter} aria-hidden="true">
                    ↵
                  </span>
                )}
              </GuardedLink>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
