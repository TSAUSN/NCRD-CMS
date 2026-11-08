'use client'
import { useEffect, useState } from 'react'
import { useNavigationGuard } from './navigation-guard.ts'
/** An unsent comment is private to this browser and this signed-in person. */
export function useCommentDraft(
  actorId: string,
  requestId: string,
  pending: boolean,
  enabled = true,
  label = 'your unsent comment (saved only in this browser)',
) {
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [baseline, setBaseline] = useState(JSON.stringify({ body: '', mentions: [] }))
  const [restored, setRestored] = useState(false)
  const key = enabled && actorId && requestId ? 'cms.comment-draft.' + actorId + '.' + requestId : ''
  const signature = JSON.stringify({ body, mentions })
  const dirty = signature !== baseline
  useEffect(() => {
    let value = { body: '', mentions: [] as string[] }
    if (key)
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (saved && typeof saved.body === 'string' && saved.body.length <= 4000 && Array.isArray(saved.mentions))
          value = {
            body: saved.body,
            mentions: saved.mentions
              .filter((id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
              .slice(0, 100),
          }
      } catch {
        /* Private browser storage is optional. */
      }
    setBody(value.body)
    setMentions(value.mentions)
    setBaseline(JSON.stringify(value))
    setRestored(Boolean(value.body))
  }, [key, requestId])
  const clear = () => {
    if (key)
      try {
        localStorage.removeItem(key)
      } catch {
        /* The visible words still clear. */
      }
    setBody('')
    setMentions([])
    setBaseline(JSON.stringify({ body: '', mentions: [] }))
    setRestored(false)
  }
  const discard = () => {
    const saved = JSON.parse(baseline) as { body: string; mentions: string[] }
    setBody(saved.body)
    setMentions(saved.mentions)
    setRestored(Boolean(saved.body))
  }
  const saveDraft = async () => {
    if (!key)
      return { ok: false, message: 'This comment cannot be saved in this browser. Keep editing or copy your words.' }
    try {
      if (body.trim() || mentions.length) localStorage.setItem(key, signature)
      else localStorage.removeItem(key)
      setBaseline(signature)
      setRestored(true)
      return { ok: true }
    } catch {
      return {
        ok: false,
        message:
          'This browser could not save your comment draft. Keep editing, copy your words, or discard the comment.',
      }
    }
  }
  useNavigationGuard(() => ({
    dirty: enabled && dirty,
    pending: enabled && pending,
    draft: { label, saveDraft, discard },
  }))
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (enabled && (dirty || pending)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [enabled, dirty, pending])
  return { body, setBody, mentions, setMentions, dirty, restored, clear, discard, saveDraft }
}
