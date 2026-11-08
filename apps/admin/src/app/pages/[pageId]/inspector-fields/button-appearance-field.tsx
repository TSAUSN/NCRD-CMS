'use client'
import contentEditorStyles from '../../../../components/content-editor.module.css'
import { Disclosure } from '../../../../components/ui/index.ts'
import { checkContrast } from '@cms/domain'
import { ButtonAppearance, DEFAULT_BUTTON_APPEARANCE } from '@cms/schema'

export function ButtonAppearanceField({
  id,
  value,
  colors,
  customCode,
  onChange,
}: {
  id: string
  value: Record<string, unknown>
  colors: Record<string, string>
  customCode: boolean
  onChange: (value: unknown) => void
}) {
  const parsed = ButtonAppearance.safeParse(value.buttonAppearance)
  const appearance = parsed.success ? parsed.data : null
  const reset = () => {
    const next = { ...value }
    delete next.buttonAppearance
    onChange(next)
  }
  const choose = (key: keyof ButtonAppearance, next: string) =>
    onChange({ ...value, buttonAppearance: { ...appearance, [key]: next } })
  const verdict = appearance
    ? checkContrast(colors[`${appearance.color}Contrast`] ?? '', colors[appearance.color] ?? '')
    : null
  return (
    <Disclosure
      className={contentEditorStyles.disclosure}
      open={Boolean(appearance) || undefined}
      title={<>Button appearance{appearance && <span className="hatch-flag">Customized</span>}</>}
    >
      <div className="hatch-body">
        {!appearance ? (
          <>
            <p className="hint">
              {customCode
                ? 'Custom HTML or CSS controls this section’s appearance.'
                : 'Use the section’s original link or button appearance, or customize this one action.'}
            </p>
            <button
              type="button"
              className="secondary small"
              disabled={customCode}
              onClick={() => onChange({ ...value, buttonAppearance: DEFAULT_BUTTON_APPEARANCE })}
            >
              Customize this button
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`${id}-button-style`}>Button treatment</label>
              <select
                id={`${id}-button-style`}
                value={appearance.style}
                onChange={event => choose('style', event.target.value)}
              >
                <option value="solid">Solid</option>
                <option value="outline">Outline</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-button-color`}>Button colour</label>
              <select
                id={`${id}-button-color`}
                value={appearance.color}
                onChange={event => choose('color', event.target.value)}
              >
                <option value="primary">Site primary</option>
                <option value="accent">Site accent</option>
              </select>
            </div>
            {verdict && <p className={verdict.passesAA ? 'hint' : 'warn-inline'}>{verdict.message}</p>}
            <p className="hint">
              Both treatments have a solid backing. Outline reverses the readable colour pair so text stays clear on
              pictures and coloured sections.
            </p>
            <div className="field">
              <label htmlFor={`${id}-button-radius`}>Button corners</label>
              <select
                id={`${id}-button-radius`}
                value={appearance.radius}
                onChange={event => choose('radius', event.target.value)}
              >
                <option value="square">Square</option>
                <option value="soft">Soft</option>
                <option value="rounded">Rounded</option>
                <option value="pill">Pill</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-button-hover`}>Button hover & keyboard focus</label>
              <select
                id={`${id}-button-hover`}
                value={appearance.hover}
                onChange={event => choose('hover', event.target.value)}
              >
                <option value="none">None</option>
                <option value="lift">Lift</option>
                <option value="invert">Reverse colours</option>
                <option value="underline">Underline</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-button-size`}>Button size</label>
              <select
                id={`${id}-button-size`}
                value={appearance.size ?? 'medium'}
                onChange={event => choose('size', event.target.value)}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-button-weight`}>Label weight</label>
              <select
                id={`${id}-button-weight`}
                value={appearance.weight ?? 'bold'}
                onChange={event => choose('weight', event.target.value)}
              >
                <option value="bold">Bold</option>
                <option value="regular">Regular</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-button-width`}>Button width</label>
              <select
                id={`${id}-button-width`}
                value={appearance.width ?? 'auto'}
                onChange={event => choose('width', event.target.value)}
              >
                <option value="auto">As wide as its words</option>
                <option value="full">Full width of its column</option>
              </select>
            </div>
            <button type="button" className="secondary small" onClick={reset}>
              Use original button appearance
            </button>
          </>
        )}
      </div>
    </Disclosure>
  )
}
