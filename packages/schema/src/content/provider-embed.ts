import { z } from 'zod'

/** Source-owned provider components. No editor value ever becomes an iframe URL. */
export const TableauEmbed = z.strictObject({
  type: z.literal('provider-embed'),
  provider: z.literal('tableau'),
  workbook: z.literal('HNIDisplay2_0_756'),
  view: z.enum(['Top10States', 'ServicesProvided2_0']),
  title: z
    .string()
    .min(1)
    .max(200)
    .refine(value => value.trim().length > 0),
})
export type TableauEmbed = z.infer<typeof TableauEmbed>
export const HNI_TABLEAU_EMBEDS = {
  timeline: {
    type: 'provider-embed',
    provider: 'tableau',
    workbook: 'HNIDisplay2_0_756',
    view: 'Top10States',
    title: 'HNI Interactive Timeline — Top 10 States by Need Level',
  },
  map: {
    type: 'provider-embed',
    provider: 'tableau',
    workbook: 'HNIDisplay2_0_756',
    view: 'ServicesProvided2_0',
    title: 'HNI National Map — Services Provided by State',
  },
} as const satisfies Record<string, TableauEmbed>
