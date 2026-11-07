'use client'
import { useId, useRef, type ReactNode } from 'react'
import styles from './controls-styles.module.css'
export type Choice = { value: string; label: string; accessibleLabel?: string; disabled?: boolean; icon?: ReactNode }
export function SegmentedControl({
  label,
  value,
  options,
  onChange,
  appearance,
  size,
  layout,
}: {
  label: string
  value: string
  options: Choice[]
  onChange: (value: string) => void
  appearance?: 'pills'
  size?: 's'
  layout?: 'balanced'
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-size={size}
      data-layout={layout}
      className={styles.segments + (appearance === 'pills' ? ' ' + styles.pills : '')}
    >
      {options.map(option => (
        <button
          type="button"
          key={option.value}
          className={styles.segment}
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <span aria-hidden="true">{option.icon}</span>}
          {option.label}
        </button>
      ))}
    </div>
  )
}
export function Tabs({
  label,
  value,
  tabs,
  onChange,
  children,
  density,
  appearance,
}: {
  density?: 'compact'
  appearance?: 'segmented'
  label: string
  value: string
  tabs: Choice[]
  onChange: (value: string) => void
  children: ReactNode
}) {
  const id = useId()
  const list = useRef<HTMLDivElement>(null)
  return (
    <>
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        className={styles.tabs}
        data-appearance={appearance}
        onKeyDown={event => {
          const enabled = tabs.filter(tab => !tab.disabled)
          const index = enabled.findIndex(tab => tab.value === value)
          const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          const next =
            event.key === 'Home'
              ? enabled[0]
              : event.key === 'End'
                ? enabled.at(-1)
                : offset
                  ? enabled[(index + offset + enabled.length) % enabled.length]
                  : null
          if (next) {
            event.preventDefault()
            onChange(next.value)
            list.current?.querySelector<HTMLButtonElement>(`[id="${CSS.escape(id + next.value)}"]`)?.focus()
          }
        }}
      >
        {tabs.map(tab => (
          <button
            type="button"
            className={styles.tab}
            role="tab"
            aria-label={tab.accessibleLabel}
            key={tab.value}
            id={id + tab.value}
            aria-controls={`${id}-panel`}
            aria-selected={value === tab.value}
            tabIndex={value === tab.value ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className={styles.tabPanel}
        data-density={density}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={id + value}
        tabIndex={0}
      >
        {children}
      </div>
    </>
  )
}

export function ProgressSteps({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  return (
    <ol className={styles.steps} aria-label={label}>
      {steps.map((step, index) => (
        <li key={step} aria-current={index === current ? 'step' : undefined}>
          <span aria-hidden="true">{index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  )
}

/** Fieldsets may share balanced multi-choice layout without changing their selection behavior. */
export function ChoiceGroup({ children, label, layout }: { children: ReactNode; label?: string; layout?: 'balanced' }) {
  return (
    <div className={styles.choiceGroup} role={label ? 'group' : undefined} aria-label={label} data-layout={layout}>
      {children}
    </div>
  )
}
