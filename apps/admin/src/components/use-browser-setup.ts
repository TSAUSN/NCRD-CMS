'use client'
import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { useNavigationGuard } from './navigation-guard.ts'

/** Private intent for forms whose explicit command changes access or live
 * routing. A leave-save must never execute that command. */
export function useBrowserSetup<T>({
  storageKey,
  initial,
  read,
  label,
  pending,
}: {
  storageKey: string
  initial: T
  read: (value: unknown) => T | null
  label: string
  pending: () => boolean
}) {
  const [value, setValue] = useState(initial),
    [baseline, setBaseline] = useState(initial),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false),
    [error, setError] = useState(''),
    finished = useRef(false)
  const signature = JSON.stringify(value),
    dirty = !finished.current && signature !== JSON.stringify(baseline)
  useEffect(() => {
    setLoading(true)
    let next = initial
    setSaved(false)
    setError('')
    finished.current = false
    try {
      const source = localStorage.getItem(storageKey)
      if (source !== null) {
        setSaved(true)
        const record = JSON.parse(source),
          restored = record?.version === 1 ? read(record.value) : null
        if (!restored) throw new Error('Invalid recovery')
        next = restored
      }
    } catch {
      setError(
        'Saved choices could not be opened in this browser. Keep your current work, or clear the saved copy and start again.',
      )
    }
    setValue(next)
    setBaseline(next)
    setLoading(false)
  }, [storageKey])
  const saveDraft = async () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, value }))
      setBaseline(value)
      setSaved(true)
      setError('')
      return { ok: true }
    } catch {
      return {
        ok: false,
        message: 'This browser could not save these choices. Keep editing, copy them, or discard the changes.',
      }
    }
  }
  const discard = () => {
    setValue(baseline)
    setError('')
  }
  const leaveState = () => ({
    dirty: !finished.current && dirty,
    pending: loading || pending(),
    draft: { label: label + ' (saved only in this browser)', saveDraft, discard },
  })
  useNavigationGuard(leaveState)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ((!finished.current && dirty) || loading || pending()) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, loading, pending])
  function clear() {
    try {
      localStorage.removeItem(storageKey)
      finished.current = false
      setValue(initial)
      setBaseline(initial)
      setSaved(false)
      setError('')
      return true
    } catch {
      setError('The saved choices could not be cleared. Keep them here and try again.')
      return false
    }
  }
  function finish() {
    finished.current = true
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* The accepted command is authoritative. */
    }
    setSaved(false)
    setError('')
  }
  function accept(next: T) {
    finish()
    setValue(next)
    setBaseline(next)
  }
  function change(next: SetStateAction<T>) {
    finished.current = false
    setValue(next)
  }
  return {
    value,
    setValue: change,
    loading,
    saved,
    error,
    dirty,
    leaveState,
    saveDraft,
    discard,
    clear,
    finish,
    accept,
  }
}
