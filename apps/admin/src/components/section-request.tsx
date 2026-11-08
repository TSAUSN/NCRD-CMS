'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestSection, respondToRequest, type RequestResult } from '../app/inbox/request-actions.ts'
import type { SectionRequest } from '../lib/inbox.ts'

function announceInboxChange() {
  window.dispatchEvent(new Event('cms:inbox-changed'))
}
export function SectionRequestForm({ siteId, preserveEditor = false }: { siteId: string; preserveEditor?: boolean }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [result, setResult] = useState<RequestResult | null>(null)
  const [pending, startTransition] = useTransition()
  const requestId = useRef<string | null>(null)
  const inFlight = useRef(false)
  return (
    <details className="card section-request-form">
      <summary>Request a custom section</summary>
      <p>
        Describe what you need and where you plan to use it. A site administrator can reply in the inbox. This does not
        change your pages or send external email.
      </p>
      <form
        onSubmit={event => {
          event.preventDefault()
          if (inFlight.current) return
          inFlight.current = true
          requestId.current ??= crypto.randomUUID()
          startTransition(async () => {
            try {
              const outcome = await requestSection(requestId.current!, siteId, title, body)
              setResult(outcome)
              if (outcome.ok) {
                setTitle('')
                setBody('')
                requestId.current = null
                announceInboxChange()
              }
            } catch {
              setResult({ ok: false, message: 'The result could not be confirmed. Check the inbox before retrying.' })
            } finally {
              inFlight.current = false
            }
          })
        }}
      >
        <fieldset disabled={pending}>
          <div className="field">
            <label htmlFor="section-request-title">What do you need?</label>
            <input
              id="section-request-title"
              value={title}
              required
              maxLength={160}
              onChange={event => {
                setTitle(event.target.value)
                requestId.current = null
              }}
              placeholder="For example, a speaker spotlight"
            />
          </div>
          <div className="field">
            <label htmlFor="section-request-body">How should it work?</label>
            <textarea
              id="section-request-body"
              value={body}
              required
              minLength={10}
              maxLength={5000}
              rows={5}
              onChange={event => {
                setBody(event.target.value)
                requestId.current = null
              }}
              placeholder="What should visitors see? Which information will you need to edit?"
            />
          </div>
          <button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send request'}
          </button>
        </fieldset>
      </form>
      {result && (
        <p className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
          {result.message}{' '}
          {result.ok && (
            <Link
              href="/inbox#custom-requests"
              target={preserveEditor ? '_blank' : undefined}
              rel={preserveEditor ? 'noopener' : undefined}
            >
              View requests in the inbox{preserveEditor ? ' (new tab)' : ''}
            </Link>
          )}
        </p>
      )}
    </details>
  )
}

export type ListedSectionRequest = Omit<SectionRequest, 'created_at' | 'updated_at'> & {
  created_at: string
  updated_at: string
}
export function SectionRequestCard({ request }: { request: ListedSectionRequest }) {
  const router = useRouter()
  const [status, setStatus] = useState<string>(request.status)
  const [response, setResponse] = useState(request.response)
  const [result, setResult] = useState<RequestResult | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  return (
    <article className="card section-request-card" id={`request-${request.id}`}>
      <h3>{request.title}</h3>
      <p>
        {request.site_name} · {request.requested_by_name} ·{' '}
        <span className="chip chip-neutral">{request.status.replaceAll('_', ' ')}</span>
      </p>
      <p className="request-body">{request.body}</p>
      {request.response && (
        <div className="notice">
          <p>
            <strong>{request.responded_by_name ?? 'Administrator'} replied:</strong>
          </p>
          <p className="request-body">{request.response}</p>
        </div>
      )}
      <p className="hint">
        Updated <time dateTime={request.updated_at}>{request.updated_at.replace('T', ' ').slice(0, 16)} UTC</time> ·{' '}
        <Link href={`/sites/${request.site_id}/sections`}>Open this site’s sections</Link>
      </p>
      {request.can_manage && (
        <details>
          <summary>Reply or update status</summary>
          <form
            onSubmit={event => {
              event.preventDefault()
              if (inFlight.current) return
              inFlight.current = true
              startTransition(async () => {
                try {
                  const outcome = await respondToRequest(request.id, request.revision, status, response)
                  setResult(outcome)
                  if (outcome.ok) {
                    announceInboxChange()
                    router.refresh()
                  }
                } catch {
                  setResult({ ok: false, message: 'The reply could not be confirmed. Reload before trying again.' })
                } finally {
                  inFlight.current = false
                }
              })
            }}
          >
            <fieldset disabled={pending}>
              <div className="field">
                <label htmlFor={`request-status-${request.id}`}>Request status</label>
                <select
                  id={`request-status-${request.id}`}
                  value={status}
                  onChange={event => setStatus(event.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="declined">Declined</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`request-response-${request.id}`}>Reply to the team</label>
                <textarea
                  id={`request-response-${request.id}`}
                  rows={4}
                  maxLength={5000}
                  required={['completed', 'declined'].includes(status)}
                  value={response}
                  onChange={event => setResponse(event.target.value)}
                />
              </div>
              <p className="hint">
                Completing or declining needs a reply. Status changes are recorded; no page or section is published by
                this form.
              </p>
              <button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save reply and status'}
              </button>
            </fieldset>
          </form>
        </details>
      )}
      {result && (
        <p className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
          {result.message}
        </p>
      )}
    </article>
  )
}
