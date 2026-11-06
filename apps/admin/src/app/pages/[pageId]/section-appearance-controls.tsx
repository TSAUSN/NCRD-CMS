'use client'
import styles from './inspector.module.css'
import { Button, SegmentedControl } from '../../../components/ui/index.ts'
import { checkContrast } from '@cms/domain'
import { type SectionAppearance } from '@cms/schema'
import type { AppearanceSupport } from '@cms/renderer'

export function SectionAppearanceControls({
  value,
  support,
  customCode,
  colors,
  onChange,
  originalDesign,
}: {
  originalDesign?: boolean
  value: SectionAppearance
  support?: AppearanceSupport
  customCode: boolean
  colors: Record<string, string>
  onChange: (appearance: SectionAppearance) => void
}) {
  function choose(key: keyof SectionAppearance, choice: string) {
    const next = { ...value }
    if (choice === '') delete next[key]
    else Object.assign(next, { [key]: choice })
    onChange(next)
  }
  if (!support?.layout || customCode)
    return (
      <p className="hint">
        {customCode
          ? 'Custom code controls this section. Clear it in Advanced before changing its style.'
          : 'This layout keeps its original style.'}
      </p>
    )
  const surfaces = [
    { value: 'page', label: 'White', background: 'surface', foreground: 'ink' },
    { value: 'soft', label: 'Light', background: 'surfaceAlt', foreground: 'ink' },
    { value: 'primary', label: 'Brand', background: 'primary', foreground: 'primaryContrast' },
    { value: 'dark', label: 'Dark', background: 'ink', foreground: 'surface' },
    ...(value.surface === 'accent'
      ? [{ value: 'accent', label: 'Accent', background: 'accent', foreground: 'accentContrast' }]
      : []),
  ]
  const imageFirst = support.imageFirst === true
  return (
    <div className={styles.content}>
      {support.surface && (
        <div className="field">
          <span className="field-label">Background</span>
          <div className={styles.swatches} role="group" aria-label="Background">
            <Button variant="secondary" size="s" aria-pressed={!value.surface} onClick={() => choose('surface', '')}>
              Default
            </Button>
            {surfaces.map(surface => (
              <Button
                key={surface.value}
                variant="secondary"
                size="s"
                disabled={!checkContrast(colors[surface.foreground] ?? '', colors[surface.background] ?? '')?.passesAA}
                aria-pressed={value.surface === surface.value}
                onClick={() => choose('surface', surface.value)}
              >
                <span className={styles.swatch} style={{ background: colors[surface.background] }} aria-hidden="true" />
                {surface.label}
              </Button>
            ))}
          </div>
          <p className="hint">
            Text colour follows the background so it stays readable.
            {!originalDesign && " Change the site's colours in Site look."}
          </p>
        </div>
      )}
      {support.spacing !== false && (
        <div className="field">
          <span className="field-label">Spacing</span>
          <SegmentedControl
            layout="balanced"
            label="Spacing"
            value={value.spacing ?? ''}
            options={[
              { value: '', label: 'Default' },
              { value: 'compact', label: 'Small', icon: <i className={styles.spacingSmall} /> },
              { value: 'comfortable', label: 'Medium', icon: <i className={styles.spacingMedium} /> },
              { value: 'spacious', label: 'Large', icon: <i className={styles.spacingLarge} /> },
            ]}
            onChange={choice => choose('spacing', choice)}
          />
        </div>
      )}
      {support.width !== false && (
        <div className="field">
          <span className="field-label">Width</span>
          <div className={styles.choices}>
            <SegmentedControl
              layout="balanced"
              label="Width"
              value={value.width ?? ''}
              options={[
                { value: '', label: 'Default' },
                { value: 'reading', label: 'Narrow' },
                { value: 'standard', label: 'Standard' },
                { value: 'wide', label: 'Wide' },
                { value: 'full', label: 'Full' },
              ]}
              onChange={choice => choose('width', choice)}
            />
          </div>
        </div>
      )}
      {support.alignment !== false && (
        <div className="field">
          <span className="field-label">Alignment</span>
          <SegmentedControl
            label="Alignment"
            value={value.align ?? ''}
            options={[
              { value: '', label: 'Default' },
              { value: 'start', label: 'Left' },
              { value: 'center', label: 'Centre' },
              ...(value.align === 'end' ? [{ value: 'end', label: 'Right' }] : []),
            ]}
            onChange={choice => choose('align', choice)}
          />
        </div>
      )}
      {support.imagePosition && (
        <div className="field">
          <span className="field-label">Image position</span>
          <SegmentedControl
            label="Image position"
            value={value.imagePosition ?? ''}
            options={[
              { value: '', label: 'Default' },
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={choice => choose('imagePosition', choice)}
          />
        </div>
      )}
      {support.mobileOrder && (
        <div className="field">
          <span className="field-label">On phones</span>
          <SegmentedControl
            label="On phones"
            value={value.mobileOrder === 'reverse' ? (imageFirst ? 'text' : 'image') : imageFirst ? 'image' : 'text'}
            options={[
              { value: 'image', label: `Image first${imageFirst ? ' · Default' : ''}` },
              { value: 'text', label: `Text first${!imageFirst ? ' · Default' : ''}` },
            ]}
            onChange={choice => choose('mobileOrder', (choice === 'image') === imageFirst ? '' : 'reverse')}
          />
        </div>
      )}
      {Object.keys(value).length > 0 && (
        <Button variant="tertiary" onClick={() => onChange({})}>
          Reset style
        </Button>
      )}
    </div>
  )
}
