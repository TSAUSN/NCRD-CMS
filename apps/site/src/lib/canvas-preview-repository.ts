import 'server-only'
import { SiteFilePath } from '@cms/schema'
import { asPublic, type ResolvedSiteFile, type ResolvedSiteAsset, type ResolvedMediaObject } from '@cms/platform'
import type { RenderManifest, SiteShell } from '@cms/renderer'
import type { CanvasResourceRepository } from './canvas-resource-handler.ts'
export type CanvasSnapshot = {
  manifest: RenderManifest
  shell: SiteShell
  navigationPaths: Record<string, string>
  parentOrigin: string
  channel: string
  showHiddenSections: boolean
}
export async function canvasSnapshot(
  host: string,
  token: string,
): Promise<{ snapshot: CanvasSnapshot; expiresAt: string } | null> {
  return asPublic(async client => {
    const value =
      (
        await client.query<{ value: { snapshot: CanvasSnapshot; expiresAt: string } | null }>(
          'SELECT public_api.canvas_snapshot($1,$2) AS value',
          [host, token],
        )
      ).rows[0]?.value ?? null
    if (
      value?.snapshot.manifest.sections.some(section =>
        section.def.slots?.some(slot => slot.constraints?.['siteWidget'] === 'chapter-directory'),
      )
    ) {
      value.snapshot.shell = {
        ...value.snapshot.shell,
        chapter_directory:
          (
            await client.query('SELECT public_api.chapter_directory($1) AS entries', [
              value.snapshot.shell.staging_host ?? host,
            ])
          ).rows[0]?.entries ?? [],
      }
    }
    return value
  })
}
const validPaths = (value: unknown): string[] =>
  Array.isArray(value) && value.length <= 2000 && value.every(path => SiteFilePath.safeParse(path).success) ? value : []
export const canvasResourceRepository: CanvasResourceRepository = {
  native: (host, token, path) =>
    asPublic(
      async client =>
        (
          await client.query<{ target: unknown }>('SELECT public_api.resolve_canvas_native_path($1,$2,$3) AS target', [
            host,
            [token],
            path,
          ])
        ).rows[0]?.target ?? null,
    ),
  path: (host, token, path) =>
    asPublic(async client => {
      const row = (
        await client.query<ResolvedSiteFile & { resource_paths: unknown }>(
          "SELECT f.*,jsonb_path_query_array(public_api.canvas_snapshot($1,$2),'$.snapshot.shell.site_files.bundle.paths[*].path') AS resource_paths FROM public_api.resolve_canvas_file_path($1,ARRAY[$2],$3) f",
          [host, token, path],
        )
      ).rows[0]
      if (!row) return null
      const { resource_paths, ...file } = row
      return { file, paths: validPaths(resource_paths) }
    }),
  paths: (host, token) =>
    asPublic(async client =>
      validPaths(
        (
          await client.query<{ paths: unknown }>(
            "SELECT jsonb_path_query_array(public_api.canvas_snapshot($1,$2),'$.snapshot.shell.site_files.bundle.paths[*].path') AS paths",
            [host, token],
          )
        ).rows[0]?.paths,
      ),
    ),
  file: (host, token, id) =>
    asPublic(
      async client =>
        (
          await client.query<ResolvedSiteFile>('SELECT * FROM public_api.resolve_canvas_file($1,$2,$3)', [
            host,
            [token],
            id,
          ])
        ).rows[0] ?? null,
    ),
  asset: (host, token, id) =>
    asPublic(
      async client =>
        (
          await client.query<ResolvedSiteAsset>('SELECT * FROM public_api.resolve_canvas_asset($1,$2,$3)', [
            host,
            [token],
            id,
          ])
        ).rows[0] ?? null,
    ),
  media: (host, token, id, variant) =>
    asPublic(async client => {
      const row = (
        await client.query<{
          media_id: string
          variant: ResolvedMediaObject['variant']
          object_key: string
          mime_type: ResolvedMediaObject['mimeType']
          bytes: string | number
          width: number
          height: number
          content_hash: string
        }>('SELECT * FROM public_api.resolve_canvas_media($1,$2,$3,$4)', [host, [token], id, variant])
      ).rows[0]
      return row
        ? {
            mediaId: row.media_id,
            variant: row.variant,
            objectKey: row.object_key,
            mimeType: row.mime_type,
            bytes: Number(row.bytes),
            width: row.width,
            height: row.height,
            contentHash: row.content_hash,
          }
        : null
    }),
}
