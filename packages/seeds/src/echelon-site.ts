import { SiteSetup } from '@cms/schema'
import { starterSiteSetup } from './archetypes.ts'
import { ECHELON_THEME } from './core-themes.ts'
import { ECHELON_PUBLIC_COPY } from './echelon-content.ts'
export function echelonSiteSetup(): SiteSetup {
  const base = starterSiteSetup('resource')
  return SiteSetup.parse({
    ...base,
    name: 'Echelon chapters',
    slug: 'echelon-chapters',
    theme: ECHELON_THEME,
    header: { ...base.header, brand: { ...base.header.brand, siteName: 'Echelon' } },
    footer: {
      ...base.footer,
      brand: { ...base.footer.brand, siteName: 'Echelon', blurb: ECHELON_PUBLIC_COPY.footer, showFoundation: false },
    },
    pages: [
      {
        slug: '',
        title: 'Home',
        template: 'echelon-home',
        layout: 'content',
        intro: ECHELON_PUBLIC_COPY.mission,
        body: '',
        menu: true,
        nested: false,
        footer: false,
      },
      {
        slug: 'chapters',
        title: 'Find a chapter',
        template: 'chapter-finder',
        layout: 'content',
        intro:
          'We are always looking for new members to join one of our Echelon chapters and become ambassadors of The Salvation Army in their local communities.',
        body: '',
        menu: true,
        nested: false,
        footer: true,
      },
    ],
  })
}
