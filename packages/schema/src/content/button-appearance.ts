import { z } from 'zod'

/** One link's closed visual choices. Colours always name a governed readable pair. */
export const ButtonAppearance = z
  .object({
    style: z.enum(['solid', 'outline']),
    color: z.enum(['primary', 'accent']),
    radius: z.enum(['square', 'soft', 'rounded', 'pill']),
    hover: z.enum(['none', 'lift', 'invert', 'underline']),
    // Optional since migration 0104, so earlier stored choices keep their look.
    size: z.enum(['small', 'medium', 'large']).optional(),
    weight: z.enum(['regular', 'bold']).optional(),
    width: z.enum(['auto', 'full']).optional(),
  })
  .strict()
export type ButtonAppearance = z.infer<typeof ButtonAppearance>
export const DEFAULT_BUTTON_APPEARANCE: ButtonAppearance = {
  style: 'solid',
  color: 'primary',
  radius: 'rounded',
  hover: 'none',
}
