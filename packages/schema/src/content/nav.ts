import { z } from 'zod'

const PageTarget = z
  .object({
    type: z.literal('page'),
    page_id: z.uuid(),
  })
  .strict()

/** An internal path or a credential-free https address: every link a site's
 * frame or menu may carry to a web address. */
export const NavUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine(value => {
    if (/\s|\\/.test(value)) return false
    if (value.startsWith('/')) return !value.startsWith('//')
    try {
      const parsed = new URL(value)
      return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
    } catch {
      return false
    }
  }, 'Use an internal path or an https URL without credentials.')

const UrlTarget = z
  .object({
    type: z.literal('url'),
    url: NavUrl,
  })
  .strict()

export const NavTarget = z.discriminatedUnion('type', [PageTarget, UrlTarget])
export type NavTarget = z.infer<typeof NavTarget>

const BaseNode = z
  .object({
    label: z.string().trim().min(1).max(80),
    target: NavTarget,
    visible: z.boolean(),
  })
  .strict()

export const NavChild = BaseNode
export type NavChild = z.infer<typeof NavChild>

export const NavNode = BaseNode.extend({
  children: z.array(NavChild).max(20).optional(),
  /** A labelled dropdown with no destination of its own. */
  dropdownGroup: z.boolean().optional(),
})
  .strict()
  .refine(node => !node.dropdownGroup || Boolean(node.children?.length), 'A dropdown group needs at least one link.')
export type NavNode = z.infer<typeof NavNode>

export const NavTree = z
  .array(NavNode)
  .max(50)
  .superRefine((tree, context) => {
    const count = tree.reduce((total, node) => total + 1 + (node.children?.length ?? 0), 0)
    if (count > 100) context.addIssue({ code: 'custom', message: 'Navigation may contain at most 100 items.' })
  })
export type NavTree = z.infer<typeof NavTree>
