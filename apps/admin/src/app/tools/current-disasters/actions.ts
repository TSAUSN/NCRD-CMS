'use server'

import { revalidatePath } from 'next/cache'
import { authProvider, currentSession } from '../../../lib/session.ts'
import { recentlyAuthenticated } from '../../../lib/people.ts'
import {
  applyDisasterEdits,
  DisasterEditError,
  parseDisasterBody,
  validateCards,
  type CardEdit,
  type CardProblem,
  type DisasterLink,
} from '../../../lib/disaster-cards.ts'
import {
  assertVersion,
  DISASTERS_ITEM_ZUID,
  pushDisasterBody,
  readDisasterItem,
  zestyConfig,
  ZestyError,
} from '../../../lib/zesty-disasters.ts'

export type PushResult =
  | { ok: true; version: number; message: string }
  | { ok: false; message: string; problems?: CardProblem[]; reauthenticate?: true; conflict?: true }

const KEY = /^(block-\d{1,4}|new-[a-z0-9-]{1,40})$/
const MAX_ITEMS = 200

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function linkOf(value: unknown): DisasterLink | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const { href, label } = value as Record<string, unknown>
  const cleanHref = text(href, 2000)
  const cleanLabel = text(label, 100)
  return cleanHref === null || cleanLabel === null ? undefined : { href: cleanHref.trim(), label: cleanLabel.trim() }
}

/** Server actions accept anything a caller sends, so the edit list is rebuilt field by field. */
function readEdits(value: unknown): CardEdit[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null
  const edits: CardEdit[] = []
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object') return null
    const raw = entry as Record<string, unknown>
    const key = text(raw['key'], 60)
    if (key === null || !KEY.test(key)) return null
    if (raw['kind'] === 'locked') {
      edits.push({ key, kind: 'locked' })
      continue
    }
    if (raw['kind'] !== 'card' || typeof raw['hidden'] !== 'boolean') return null
    const title = text(raw['title'], 400)
    const description = text(raw['description'], 4000)
    const imageUrl = raw['imageUrl'] === null ? null : text(raw['imageUrl'], 2000)
    const learnMore = linkOf(raw['learnMore'])
    const donate = linkOf(raw['donate'])
    if (title === null || description === null || learnMore === undefined || donate === undefined) return null
    if (raw['imageUrl'] !== null && imageUrl === null) return null
    edits.push({
      key,
      kind: 'card',
      hidden: raw['hidden'],
      title: title.trim(),
      description: description.trim(),
      imageUrl: imageUrl === null ? null : imageUrl.trim(),
      learnMore,
      donate,
    })
  }
  return edits
}

/** Saves the edited cards as a new version of the Zesty page and publishes it on the live site. */
export async function pushCurrentDisasters(input: { version: unknown; edits: unknown }): Promise<PushResult> {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin)
    return { ok: false, message: 'Only a super admin can change Current Disasters.' }
  if (authProvider().name !== 'local' && !recentlyAuthenticated(session.authenticatedAt))
    return {
      ok: false,
      reauthenticate: true,
      message: 'Please confirm your sign-in in another tab, then push again. Your edits will stay here.',
    }
  const version = input.version
  const edits = readEdits(input.edits)
  if (typeof version !== 'number' || !Number.isInteger(version) || !edits)
    return { ok: false, message: 'The edits could not be read. Reload the page and try again.' }
  const problems = validateCards(edits)
  if (problems.length) return { ok: false, message: 'Fix the highlighted fields before pushing.', problems }
  const settings = zestyConfig()
  if (!settings.ok) return { ok: false, message: 'The Zesty connection is not set up on this server.' }
  try {
    const current = await readDisasterItem(settings.config)
    assertVersion(current, version)
    const body = applyDisasterEdits(parseDisasterBody(current.body), edits)
    if (body === current.body)
      return { ok: true, version: current.version, message: 'Nothing changed, so nothing was pushed.' }
    const pushed = await pushDisasterBody(settings.config, current, body)
    // Cloud Logging keeps this line as the record of who changed the live page.
    console.info(
      JSON.stringify({
        event: 'zesty_current_disasters_published',
        user: session.email,
        item: DISASTERS_ITEM_ZUID,
        previousVersion: pushed.previousVersion,
        version: pushed.version,
      }),
    )
    revalidatePath('/tools/current-disasters')
    return {
      ok: true,
      version: pushed.version,
      message: `Published version ${pushed.version}. The live page can take a few minutes to update.`,
    }
  } catch (error) {
    if (error instanceof ZestyError)
      return { ok: false, message: error.message, ...(error.kind === 'conflict' ? { conflict: true as const } : {}) }
    if (error instanceof DisasterEditError) return { ok: false, message: error.message, conflict: true }
    console.error(JSON.stringify({ event: 'zesty_current_disasters_failed', message: (error as Error).message }))
    return { ok: false, message: 'The push could not be completed. Reload to check the page before trying again.' }
  }
}
