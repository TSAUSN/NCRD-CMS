import { z } from 'zod'

/** Missing choices retain the pinned definition's original rendering. */
export const SectionAppearance = z.strictObject({
  surface: z.enum(['page', 'soft', 'primary', 'accent', 'dark']).optional(),
  spacing: z.enum(['compact', 'comfortable', 'spacious']).optional(),
  width: z.enum(['reading', 'standard', 'wide', 'full']).optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
  imagePosition: z.enum(['left', 'right']).optional(),
  mobileOrder: z.literal('reverse').optional(),
})
export type SectionAppearance = z.infer<typeof SectionAppearance>
