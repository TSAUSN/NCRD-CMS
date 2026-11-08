'use client'
import type { CSSProperties } from 'react'
import type { ThemeTokens } from '@cms/schema'
import { SELF_HOSTED_TYPE_PAIRINGS } from '../lib/site-look.ts'
import { Button } from './ui/index.ts'
import styles from './theme-choice-fields.module.css'
type Props = { tokens: ThemeTokens; disabled: boolean; onChange: (tokens: ThemeTokens) => void }
export function ThemeFontPairings({ tokens, disabled, onChange }: Props) {
  const selected = SELF_HOSTED_TYPE_PAIRINGS.find(
    pair => pair.heading === tokens.fonts.heading && pair.body === tokens.fonts.body,
  )
  return (
    <div className={styles.pairings} role="group" aria-label="Font pairings">
      {!selected && (
        <p className={styles.help}>
          Your current fonts are kept until you choose a pairing. More font choices are below.
        </p>
      )}
      {SELF_HOSTED_TYPE_PAIRINGS.map(pair => (
        <Button
          key={pair.name}
          variant="secondary"
          className={styles.choice}
          aria-label={'Use ' + pair.name + ' type'}
          aria-pressed={selected === pair}
          disabled={disabled}
          onClick={() => onChange({ ...tokens, fonts: { heading: pair.heading, body: pair.body } })}
        >
          <strong>{pair.name}</strong>
          <span className={styles.typeHeading} style={{ fontFamily: pair.heading }}>
            A place to belong
          </span>
          <span className={styles.typeBody} style={{ fontFamily: pair.body }}>
            Everyone brings something to the story.
          </span>
          <span className={styles.help}>{pair.description}</span>
        </Button>
      ))}
    </div>
  )
}
const shapes = [
  ['0rem', 'Square'],
  ['0.25rem', 'Soft'],
  ['0.5rem', 'Rounded'],
  ['0.75rem', 'Rounder'],
  ['1rem', 'Pill'],
] as const
const fills = [
  ['solid', 'Filled'],
  ['outline', 'Outline'],
  ['text', 'Text only'],
] as const
const hovers = [
  ['none', 'No change'],
  ['darken', 'Darken'],
  ['lift', 'Lift'],
  ['invert', 'Invert'],
  ['underline', 'Underline'],
] as const
export function ThemeButtonChoices({ tokens, disabled, onChange }: Props) {
  const buttons = tokens.buttons
  const color = buttons.color === 'accent' ? tokens.colors.accent : tokens.colors.primary
  const ink = buttons.color === 'accent' ? tokens.colors.accentContrast : tokens.colors.primaryContrast
  const vars = {
    '--sample-fill': color,
    '--sample-ink': ink,
    '--sample-surface': tokens.colors.surface,
    '--sample-radius': buttons.radius,
    '--sample-speed':
      buttons.speed === 'fast'
        ? 'var(--motion-fast)'
        : buttons.speed === 'slow'
          ? 'var(--motion-slow)'
          : 'var(--motion-panel)',
    '--sample-weight': buttons.weight === 'bold' ? 'var(--weight-bold)' : 'var(--weight-regular)',
  } as CSSProperties
  return (
    <div className={styles.buttonChoices} style={vars}>
      <fieldset>
        <legend>Style</legend>
        <div className={styles.threeChoices}>
          {fills.map(([style, label]) => (
            <Button
              key={style}
              variant="secondary"
              className={styles.choice}
              disabled={disabled}
              aria-label={'Use ' + label + ' buttons'}
              aria-pressed={buttons.style === style}
              onClick={() => onChange({ ...tokens, buttons: { ...buttons, style } })}
            >
              <strong>{label}</strong>
              <span aria-hidden="true" className={styles.sample} data-style={style}>
                Explore
              </span>
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Shape</legend>
        <div className={styles.twoChoices}>
          {shapes.map(([radius, label]) => (
            <Button
              key={radius}
              variant="secondary"
              className={styles.choice}
              disabled={disabled}
              aria-label={'Use ' + label + ' button shape'}
              aria-pressed={buttons.radius === radius}
              onClick={() => onChange({ ...tokens, buttons: { ...buttons, radius } })}
            >
              <strong>{label}</strong>
              <span
                aria-hidden="true"
                className={styles.sample}
                data-style={buttons.style}
                style={{ borderRadius: radius }}
              >
                Explore
              </span>
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Hover</legend>
        <p className={styles.help}>Point at a choice to try it.</p>
        <div className={styles.twoChoices}>
          {hovers.map(([hover, label]) => (
            <Button
              key={hover}
              variant="secondary"
              className={styles.choice}
              disabled={disabled}
              aria-label={'Use ' + label + ' button hover'}
              aria-pressed={buttons.hover === hover}
              onClick={() => onChange({ ...tokens, buttons: { ...buttons, hover } })}
            >
              <strong>{label}</strong>
              <span aria-hidden="true" className={styles.sample} data-style={buttons.style} data-hover={hover}>
                Explore
              </span>
            </Button>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
