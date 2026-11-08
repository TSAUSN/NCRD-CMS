import { Button, Card, Disclosure, Field } from '../../../../components/ui/index.ts'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { NATIONAL_THEME } from '@cms/seeds/core-themes'
import { ThemeFontPairings, ThemeButtonChoices } from '../../../../components/theme-choice-fields.tsx'
import { DEFAULT_THEME_TOKENS, THEME_FONT_OPTIONS, type ThemeTokens } from '@cms/schema'
import type { Dispatch, SetStateAction } from 'react'
import { serializeThemeTokens } from './use-theme-draft.ts'

export function ThemeAppearanceFields({
  tokens,
  setTokens,
  canManage,
  pending,
  controlsOnly,
  usage,
  onStartingDesign,
}: {
  tokens: ThemeTokens
  setTokens: Dispatch<SetStateAction<ThemeTokens>>
  canManage: boolean
  pending: boolean
  controlsOnly: boolean
  usage: Record<string, number>
  onStartingDesign: () => void
}) {
  return (
    <>
      <Card title="Type pairing" id="theme-type-title" density="editor">
        <p className="hint">Choose a heading and body pairing. The specimens use fonts included with your site.</p>
        <ThemeFontPairings tokens={tokens} disabled={pending || !canManage} onChange={setTokens} />
        <Disclosure title="More font choices">
          <div className={listInspectorStyles.formStack}>
            <Field id="theme-heading-font" label="Headings">
              <select
                id="theme-heading-font"
                value={tokens.fonts.heading}
                disabled={!canManage}
                onChange={event =>
                  setTokens(current => ({
                    ...current,
                    fonts: { ...current.fonts, heading: event.target.value as ThemeTokens['fonts']['heading'] },
                  }))
                }
              >
                {THEME_FONT_OPTIONS.map(font => (
                  <option value={font.value} key={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="theme-body-font" label="Body copy">
              <select
                id="theme-body-font"
                value={tokens.fonts.body}
                disabled={!canManage}
                onChange={event =>
                  setTokens(current => ({
                    ...current,
                    fonts: { ...current.fonts, body: event.target.value as ThemeTokens['fonts']['body'] },
                  }))
                }
              >
                {THEME_FONT_OPTIONS.map(font => (
                  <option value={font.value} key={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Disclosure>
      </Card>

      <Card title="Buttons and links" id="theme-button-title" density="editor">
        <p className="hint">One button style for the whole site.</p>
        <ThemeButtonChoices tokens={tokens} disabled={pending || !canManage} onChange={setTokens} />
        <Disclosure title="More button options">
          <div className={listInspectorStyles.formStack}>
            <ThemeSelect
              label="Colour"
              value={tokens.buttons.color}
              disabled={!canManage}
              options={[
                ['primary', 'Primary'],
                ['accent', 'Accent'],
              ]}
              onChange={color =>
                setTokens(current => ({
                  ...current,
                  buttons: { ...current.buttons, color: color as ThemeTokens['buttons']['color'] },
                }))
              }
            />
            <ThemeSelect
              label="Label"
              value={tokens.buttons.weight}
              disabled={!canManage}
              options={[
                ['regular', 'Regular'],
                ['bold', 'Bold'],
              ]}
              onChange={weight =>
                setTokens(current => ({
                  ...current,
                  buttons: { ...current.buttons, weight: weight as ThemeTokens['buttons']['weight'] },
                }))
              }
            />
            <ThemeSelect
              label="Hover speed"
              value={tokens.buttons.speed}
              disabled={!canManage}
              options={[
                ['fast', 'Fast'],
                ['normal', 'Normal'],
                ['slow', 'Slow'],
              ]}
              onChange={speed =>
                setTokens(current => ({
                  ...current,
                  buttons: { ...current.buttons, speed: speed as ThemeTokens['buttons']['speed'] },
                }))
              }
            />
          </div>
        </Disclosure>
      </Card>

      <Card title="Site density" id="theme-rhythm-title" density="editor">
        <p className="hint">How roomy sections feel across the whole site.</p>
        <div className={listInspectorStyles.formStack}>
          <ThemeSelect
            label="Spacing"
            value={tokens.spacing}
            disabled={!canManage}
            options={[
              ['compact', 'Compact'],
              ['comfortable', 'Comfortable'],
              ['spacious', 'Spacious'],
            ]}
            onChange={spacing => setTokens(current => ({ ...current, spacing: spacing as ThemeTokens['spacing'] }))}
          />
          <ThemeSelect
            label="Card corners"
            value={tokens.radius}
            disabled={!canManage}
            options={[
              ['0rem', 'Square'],
              ['0.25rem', 'Soft'],
              ['0.5rem', 'Rounded'],
              ['0.75rem', 'Rounder'],
              ['1rem', 'Pill'],
              ['1.25rem', 'National rounded'],
            ]}
            onChange={radius => setTokens(current => ({ ...current, radius: radius as ThemeTokens['radius'] }))}
          />
          {!tokens.presentation?.template && (
            <ThemeSelect
              label="Page layout"
              value={tokens.presentation?.kind ?? 'standard'}
              disabled={!canManage}
              options={[
                ['standard', 'Standard'],
                ['panels', 'Rounded panels'],
              ]}
              onChange={kind =>
                setTokens(current => {
                  const { presentation, ...rest } = current
                  return kind === 'panels'
                    ? {
                        ...rest,
                        presentation: {
                          kind: 'panels',
                          canvas: presentation?.canvas ?? NATIONAL_THEME.presentation!.canvas,
                        },
                      }
                    : rest
                })
              }
            />
          )}
          {tokens.presentation?.template && <p role="note">The national template sets the page layout.</p>}
        </div>
        {canManage && (
          <div className="theme-defaults-action">
            <Button
              variant="secondary"
              disabled={serializeThemeTokens(tokens) === serializeThemeTokens(DEFAULT_THEME_TOKENS)}
              onClick={onStartingDesign}
            >
              Use the standard Salvation Army starting design
            </Button>
            <small>This changes the local draft only. Review it, then save.</small>
          </div>
        )}
      </Card>
    </>
  )
}

function ThemeSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const id = `theme-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <Field id={id} label={label}>
      <select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {options.map(([option, name]) => (
          <option key={option} value={option}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  )
}
