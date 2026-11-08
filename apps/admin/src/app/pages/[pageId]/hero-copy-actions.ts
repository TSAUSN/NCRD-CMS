'use server'
import { asUser } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import {
  PageContent,
  isHeroSlides,
  heroSlideContentProblem,
  heroSlideParityProblem,
  migrateHeroSlides,
  type FieldLike,
} from '@cms/schema'
import { currentSession } from '../../../lib/session.ts'
import { appendCopiedHeroSlide } from '../../../lib/hero-slide-copy.ts'
export async function loadHeroCopyTargets(pageId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to copy a slide.' }
  try {
    return await asUser({ userId: session.principal.userId }, async client => {
      const source = (
        await client.query<{ site_id: string }>('SELECT site_id FROM pages WHERE id=$1 AND archived_at IS NULL', [
          pageId,
        ])
      ).rows[0]
      if (!source) return { ok: false as const, message: 'This page is unavailable.' }
      const pages = (
        await client.query<{ id: string; title: string; revision: string }>(
          'SELECT id,title,revision::text FROM pages WHERE site_id=$1 AND id<>$2 AND archived_at IS NULL ORDER BY title,id',
          [source.site_id, pageId],
        )
      ).rows
      return { ok: true as const, pages }
    })
  } catch {
    return { ok: false as const, message: 'Pages could not be loaded. Try again, or return to the slide.' }
  }
}
export async function copyHeroSlide(input: {
  sourcePageId: string
  definitionId: string
  version: number
  slotId: string
  key: string
  values: Record<string, unknown>
  targetPageId: string
  targetRevision: string
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to copy a slide.' }
  try {
    return await mapErrors(() =>
      asUser({ userId: session.principal.userId }, async client => {
        const source = (
          await client.query<{ site_id: string; content: unknown; published_content: unknown }>(
            'SELECT p.site_id,v.content,published.content AS published_content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id LEFT JOIN page_versions published ON published.id=p.published_version_id WHERE p.id=$1 AND p.archived_at IS NULL',
            [input.sourcePageId],
          )
        ).rows[0]
        if (
          !source ||
          !PageContent.parse(source.content).some(section => section.section_def_id === input.definitionId)
        )
          throw new DomainError('not_authorized', 'This slide is not available on your page.')
        const definition = (
          await client.query<{ slots: FieldLike[] }>(
            'SELECT v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1 AND v.version=$2 AND d.slug=$3 AND d.scope=$4',
            [input.definitionId, input.version, 'core-feature-slider', 'global'],
          )
        ).rows[0]
        const slot = definition?.slots.find(
          slot => slot.id === input.slotId && isHeroSlides(slot) && slot.constraints?.heroEditingParity === true,
        )
        if (!slot) throw new DomainError('invalid_state', 'Review the updated Hero slider before copying this slide.')
        const problem =
          heroSlideContentProblem(input.values, slot.id, input.key) ||
          heroSlideParityProblem(
            input.values,
            slot.id,
            input.key,
            source.published_content
              ? PageContent.parse(source.published_content).filter(
                  section => section.section_def_id === input.definitionId,
                ).length === 1
                ? PageContent.parse(source.published_content).find(
                    section => section.section_def_id === input.definitionId,
                  )?.values[slot.id + '__' + input.key + '__intro']
                : undefined
              : undefined,
          )
        if (problem) throw new DomainError('invalid_state', problem)
        const target = (
          await client.query<{ title: string; revision: string; content: unknown; meta: unknown }>(
            'SELECT p.title,p.revision::text,v.content,v.meta FROM pages p LEFT JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1 AND p.site_id=$2 AND p.id<>$3 AND p.archived_at IS NULL',
            [input.targetPageId, source.site_id, input.sourcePageId],
          )
        ).rows[0]
        if (!target) throw new DomainError('not_authorized', 'Choose another page on this site that you can edit.')
        if (target.revision !== input.targetRevision)
          throw new DomainError(
            'stale_revision',
            'The destination page changed. Reload the page choices before copying.',
          )
        const content = PageContent.parse(target.content ?? [])
        const at = content.findIndex(section => section.section_def_id === input.definitionId)
        const before = at >= 0 ? content[at]! : null
        let destinationSlot = slot
        let destinationVersion = input.version
        if (before && before.section_def_version > input.version) {
          const newer = (
            await client.query<{ slots: FieldLike[] }>(
              'SELECT slots FROM section_def_versions WHERE section_def_id=$1 AND version=$2',
              [input.definitionId, before.section_def_version],
            )
          ).rows[0]?.slots.find(
            candidate =>
              candidate.id === slot.id && isHeroSlides(candidate) && candidate.constraints?.heroEditingParity === true,
          )
          if (!newer) throw new DomainError('invalid_state', 'Review the destination Hero slider before copying.')
          destinationSlot = newer
          destinationVersion = before.section_def_version
        }
        const values = before ? migrateHeroSlides(before.values) : { heading: target.title, slides: { items: [] } }
        const copied = appendCopiedHeroSlide(input.values, slot, input.key, values, destinationSlot)
        if (!copied)
          throw new DomainError(
            'invalid_state',
            'The destination already has 48 slides, or this slide is no longer available.',
          )
        const section = PageContent.parse([
          {
            ...(before ?? {}),
            section_def_id: input.definitionId,
            section_def_version: destinationVersion,
            values: copied.values,
          },
        ])[0]!
        if (at >= 0) content[at] = section
        else content.push(section)
        const saved = (
          await client.query<{ revision: string; version_id: string }>(
            "SELECT revision::text,version_id FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)",
            [
              input.targetPageId,
              input.targetRevision,
              JSON.stringify(content),
              JSON.stringify(target.meta ?? {}),
              'Copied a hero slide, switched off',
            ],
          )
        ).rows[0]!
        return {
          ok: true as const,
          pageId: input.targetPageId,
          title: target.title,
          revision: saved.revision,
          versionId: saved.version_id,
          message:
            'Copied to ' + target.title + ' as a draft, switched off. Review and publish that page when it is ready.',
        }
      }),
    )
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The copy could not be confirmed. Check the destination page before trying again.',
    }
  }
}
