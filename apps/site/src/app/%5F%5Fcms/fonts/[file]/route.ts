import { readLocalBrandFont, serveLocalBrandFont } from '@cms/platform'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ file: string }> }): Promise<Response> {
  return serveLocalBrandFont(request, (await context.params).file, {
    local: process.env['CMS_LOCAL_TEST_MODE'] === 'true',
    publicHosting: process.env['CMS_SERVE_LICENSED_BRAND_FONTS'] === 'true',
    read: readLocalBrandFont,
  })
}
export const HEAD = GET
