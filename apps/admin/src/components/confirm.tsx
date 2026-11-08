'use client'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button, Dialog, Field } from './ui/index.ts'
import styles from './confirm.module.css'

export type ConfirmProps = {
  title: string
  size?: 'standard' | 'medium' | 'wide'
  /** What will happen, in one sentence. */
  what: ReactNode
  /** What is *not* affected, and whether it can be undone. */
  reassurance?: ReactNode
  confirmLabel: string
  pending?: boolean
  confirmDisabled?: boolean
  error?: string | undefined
  onConfirm: () => void
  onCancel: () => void
}

/** Native top-layer dialogs also work above drawers and other modal reviews. */
export function ConfirmDialog({
  title,
  what,
  reassurance,
  confirmLabel,
  pending = false,
  confirmDisabled = false,
  error,
  tone = 'danger',
  onConfirm,
  onCancel,
  size,
}: ConfirmProps & { tone?: 'danger' | 'primary' | 'publish' }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancel.current?.focus()
  }, [])
  return (
    <Dialog
      title={title}
      size={size}
      showClose={false}
      role="alertdialog"
      pending={pending}
      onClose={onCancel}
      footer={
        <>
          <Button
            ref={cancel}
            autoFocus
            variant="secondary"
            aria-disabled={pending}
            onClick={() => {
              if (!pending) onCancel()
            }}
          >
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : tone}
            disabled={pending || confirmDisabled}
            loading={pending}
            onClick={() => {
              if (!pending && !confirmDisabled) onConfirm()
            }}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <div>{what}</div>
        {reassurance && <p>{reassurance}</p>}
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/** Recorded exceptions and review notes share modality, focus and field styling. */
export function ReasonDialog({
  title,
  explanation,
  label,
  value,
  confirmLabel,
  required = true,
  minLength = 1,
  pending = false,
  tone = 'primary',
  onChange,
  onConfirm,
  onCancel,
}: {
  title: string
  explanation: ReactNode
  label: string
  value: string
  confirmLabel: string
  required?: boolean
  minLength?: number
  pending?: boolean
  tone?: 'primary' | 'destructive'
  onChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const ready = !required || value.trim().length >= minLength
  useEffect(() => {
    if (!pending) field.current?.focus()
  }, [pending])
  return (
    <Dialog
      title={title}
      showClose={false}
      pending={pending}
      onClose={onCancel}
      footer={
        <>
          <Button
            variant="secondary"
            aria-disabled={pending}
            onClick={() => {
              if (!pending) onCancel()
            }}
          >
            Cancel
          </Button>
          <Button
            variant={tone}
            disabled={!ready || pending}
            loading={pending}
            onClick={() => {
              if (!pending && ready) onConfirm()
            }}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <p>{explanation}</p>
        <Field
          id={id}
          label={label}
          help={required && minLength > 1 ? `Use at least ${minLength} characters.` : undefined}
        >
          <textarea
            ref={field}
            autoFocus
            rows={4}
            value={value}
            disabled={pending}
            aria-required={required}
            minLength={required ? minLength : undefined}
            onChange={event => {
              if (!pending) onChange(event.target.value)
            }}
          />
        </Field>
      </div>
    </Dialog>
  )
}
