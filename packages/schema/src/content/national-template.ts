import { z } from 'zod'
export const NationalTemplateSelection = z
  .array(z.object({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
  .min(1)
  .max(50)
export const NationalSiteStart = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    source: z.enum(['copy', 'templates', 'home']),
    sourceSiteId: z.uuid().optional(),
    bringWords: z.boolean(),
    bringStories: z.boolean(),
  })
  .strict()
export const NationalStartRequestId = z.uuidv4()
