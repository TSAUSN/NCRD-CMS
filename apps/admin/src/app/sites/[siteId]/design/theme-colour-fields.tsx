import { Badge, Button, Card } from '../../../../components/ui/index.ts'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import ownedStyles from './theme-editor-styles.module.css'
import { useState } from 'react'
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '@cms/schema'
import { checkContrast, type ContrastVerdict } from '@cms/domain'
import type { Dispatch, SetStateAction } from 'react'

const COLOR_CONTROLS: { key: keyof ThemeTokens['colors']; label: string; help: string }[] = [
  { key: 'primary', label: 'Primary', help: 'Header rule, focus rings and the main action colour.' },
  { key: 'primaryContrast', label: 'On primary', help: 'Text and icons shown on the primary colour.' },
  { key: 'accent', label: 'Accent', help: 'A second action or emphasis colour.' },
  { key: 'accentContrast', label: 'On accent', help: 'Text and icons shown on the accent colour.' },
  { key: 'surface', label: 'Page', help: 'The main page and navigation background.' },
  { key: 'surfaceAlt', label: 'Soft surface', help: 'Cards and quiet bands that need separation.' },
  { key: 'ink', label: 'Text', help: 'Headings and body copy on the main page colour.' },
  { key: 'muted', label: 'Muted text', help: 'Supporting copy, labels and less prominent details.' },
]

function verdictFor(
  key: keyof ThemeTokens['colors'],
  colors: ThemeTokens['colors'],
): ContrastVerdict | null | undefined {
  if (key === 'ink') return checkContrast(colors.ink, colors.surface)
  if (key === 'primaryContrast') return checkContrast(colors.primaryContrast, colors.primary)
  if (key === 'accentContrast') return checkContrast(colors.accentContrast, colors.accent)
  return undefined
}

export function ThemeColourFields({
  tokens,
  setTokens,
  controlsOnly,
  approvedPrimary,
  canManage,
  usage,
}: {
  tokens: ThemeTokens
  setTokens: Dispatch<SetStateAction<ThemeTokens>>
  controlsOnly: boolean
  approvedPrimary: boolean
  canManage: boolean
  usage: Record<string, number>
}) {
  const [advancedColours, setAdvancedColours] = useState(false)
  function setColor(key: keyof ThemeTokens['colors'], value: string) {
    setTokens(current => ({ ...current, colors: { ...current.colors, [key]: value } }))
  }
  return (
    <Card
      title="Colours"
      id="theme-colours-title"
      density="editor"
      headerActions={
        controlsOnly ? (
          <Button
            variant="tertiary"
            size="compact"
            aria-expanded={advancedColours}
            onClick={() => setAdvancedColours(value => !value)}
          >
            Advanced colours
          </Button>
        ) : undefined
      }
    >
      <div className={listInspectorStyles.formStack}>
        {COLOR_CONTROLS.map(control => {
          const pair = controlsOnly
            ? control.key === 'primary'
              ? checkContrast(tokens.colors.primaryContrast, tokens.colors.primary)
              : control.key === 'accent'
                ? checkContrast(tokens.colors.accentContrast, tokens.colors.accent)
                : ['ink', 'surface'].includes(control.key)
                  ? checkContrast(tokens.colors.ink, tokens.colors.surface)
                  : verdictFor(control.key, tokens.colors)
            : verdictFor(control.key, tokens.colors)
          const label = controlsOnly
            ? (({ primary: 'Brand', accent: 'Accent', ink: 'Dark', surface: 'Light' } as Record<string, string>)[
                control.key
              ] ?? control.label)
            : control.label
          const uses = usage[control.key] ?? 0
          const approvedPair = approvedPrimary && ['primary', 'primaryContrast'].includes(control.key)
          return (
            <div
              className={ownedStyles.colourRole}
              data-compact={(controlsOnly && !advancedColours) || undefined}
              key={control.key}
              hidden={
                controlsOnly && !advancedColours && !['primary', 'accent', 'ink', 'surface'].includes(control.key)
              }
            >
              <label htmlFor={`theme-${control.key}`}>{label}</label>
              <div className={ownedStyles.colourInputs}>
                <input
                  type="color"
                  aria-label={`${label} colour picker`}
                  value={tokens.colors[control.key]}
                  disabled={!canManage}
                  onChange={event => setColor(control.key, event.target.value)}
                />
                <input
                  id={`theme-${control.key}`}
                  value={tokens.colors[control.key]}
                  maxLength={7}
                  aria-invalid={!/^#[0-9a-f]{6}$/i.test(tokens.colors[control.key]) || undefined}
                  aria-describedby={
                    !/^#[0-9a-f]{6}$/i.test(tokens.colors[control.key]) ? 'theme-colour-error' : undefined
                  }
                  disabled={!canManage}
                  spellCheck={false}
                  onChange={event => setColor(control.key, event.target.value)}
                />
              </div>
              {(!controlsOnly || advancedColours) && <p className="hint">{control.help}</p>}
              {(!controlsOnly || advancedColours) && (
                <small>
                  {['primary', 'surface', 'ink'].includes(control.key)
                    ? `Used by the site shell${uses > 0 ? ` and ${uses} ${uses === 1 ? 'page' : 'pages'}` : ''}.`
                    : uses > 0
                      ? `Used on ${uses} ${uses === 1 ? 'page' : 'pages'}.`
                      : 'Available to sections that opt into this role.'}
                </small>
              )}
              <div className={ownedStyles.colourMeta}>
                {pair !== undefined && (
                  <Badge
                    tone={approvedPair ? 'neutral' : pair?.passesAA ? 'live' : 'error'}
                    title={approvedPair ? 'The approved national red and white pair does not meet 4.5:1.' : undefined}
                  >
                    {pair
                      ? `${pair.display} ${approvedPair ? 'Approved pair' : pair.passesAA ? 'AA' : 'Needs 4.5:1'}`
                      : 'Not a colour yet'}
                  </Badge>
                )}
                {canManage && tokens.colors[control.key] !== DEFAULT_THEME_TOKENS.colors[control.key] && (
                  <Button
                    variant="tertiary"
                    size="compact"
                    onClick={() => setColor(control.key, DEFAULT_THEME_TOKENS.colors[control.key])}
                  >
                    Reset {label.toLowerCase()}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {approvedPrimary && (
        <p role="note" className="hint">
          The national template keeps the approved red and white button colours.
        </p>
      )}
    </Card>
  )
}
