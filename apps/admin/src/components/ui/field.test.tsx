import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Field } from './field.tsx'
it('connects the label, help and error to the control while preserving other descriptions', () => {
  const html = renderToStaticMarkup(
    <Field id="name" label="Name" help="Use your full name" error="Enter a name" required>
      <input aria-describedby="existing" defaultValue="Kept" />
    </Field>,
  )
  expect(html).toContain('for="name"')
  expect(html).toContain('id="name"')
  expect(html).toContain('aria-describedby="existing name-help name-error"')
  expect(html).toContain('aria-invalid="true"')
  expect(html).toContain('required=""')
  expect(html).toContain('value="Kept"')
})
