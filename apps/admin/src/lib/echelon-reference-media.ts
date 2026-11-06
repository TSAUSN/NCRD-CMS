import 'server-only'
import { getSite } from './queries.ts'
import { importReferenceMedia, type ReferenceImage, type ImportedReferenceImage } from './reference-media.ts'
export type EchelonReferenceImage = ReferenceImage
export type EchelonImportedImage = ImportedReferenceImage
/** Preserve the chapter-only import contract;all upload and processing commands are shared. */
export async function importEchelonReferenceMedia(input: Omit<Parameters<typeof importReferenceMedia>[0], 'profile'>) {
  const site = await getSite(input.userId, input.siteId)
  if (!site || !site.chapters_enabled || site.original_design)
    throw new Error('Choose the native Echelon chapters site.')
  return importReferenceMedia({
    ...input,
    profile: {
      folder: 'Echelon reference',
      tags: ['echelon', 'template reference'],
      attribution: 'Approved template reference — confirm photo rights before hosting.',
      replacementAttribution: 'Borrowed chapter reference — replace with a chapter photo.',
    },
  })
}
