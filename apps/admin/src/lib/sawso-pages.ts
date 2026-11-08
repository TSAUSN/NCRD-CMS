import { migrateHeroSlides } from '@cms/schema'
import { isDeepStrictEqual } from 'node:util'
import { SAWSO_HOME_APPROVED } from '@cms/seeds/sawso-home-approved'
import type { Queryable } from '@cms/platform'
import type { SectionInstance, SectionAppearance } from '@cms/schema'
import { SAWSO_APPROVED, STORY_SECTORS, sawsoStoryRows, storiesBinding } from '@cms/seeds/sawso-stories'
import { corePageDefinitions } from './core-pages.ts'
import type { CorePageDefinition } from '@cms/seeds/core-templates'
const sectorSources: Record<string, string> = {
  'anti-human-trafficking': 'anti',
  'business-economic-development': 'business',
  'capacity-building': 'capacity',
  'disaster-relief-recovery': 'disaster',
  education: 'education',
  'family-care': 'family',
  health: 'health',
  livelihoods: 'livelihoods',
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const paragraphs = (list: readonly string[]) => list.map(p => '<p>' + escape(p) + '</p>').join('')
export function sawsoSection(
  defs: CorePageDefinition[],
  slug: string,
  label: string,
  values: Record<string, unknown>,
  appearance?: SectionAppearance,
): SectionInstance {
  const def = defs.find(def => def.slug === 'core-' + slug)
  if (!def) throw new Error('Install the shared story sections first.')
  return {
    section_def_id: def.id,
    section_def_version: def.version,
    label,
    values:
      slug === 'story-detail' && def.slots?.some(slot => slot.id === 'library_link')
        ? { library_link: { url: '/newsroom', label: 'Newsroom' }, ...values }
        : values,
    hidden: false,
    hidden_at: [],
    ...(appearance ? { appearance } : {}),
  }
}
export function sawsoFeed(defs: CorePageDefinition[], sector: string | null, limit: 3 | 6 | 9 = 6, exclude?: string) {
  const name = STORY_SECTORS.find(s => s.id === sector)?.label.toLowerCase() ?? '[sector]',
    url = '/newsroom' + (sector ? '?sector=' + sector : '')
  return sawsoSection(defs, 'stories', 'Stories', {
    heading: sector ? 'Stories about ' + name : 'Latest stories',
    stories: storiesBinding(sector, limit, exclude),
    empty_mode: 'line',
    empty_line: 'Check back soon for stories from our ' + name + ' work.',
    more: { label: 'More stories', url },
    newsroom: { label: 'Visit our newsroom', url },
  })
}
function sawsoOverview(defs: CorePageDefinition[], sector: string): SectionInstance[] {
  const source = sectorSources[sector]!,
    copy = SAWSO_APPROVED.pages[(source + '-overview') as keyof typeof SAWSO_APPROVED.pages] as {
      heading: string
      paragraphs: readonly string[]
    },
    name = STORY_SECTORS.find(s => s.id === sector)!.label
  return [
    sawsoSection(defs, 'page-header', 'Page header', { heading: name, intro: '' }, { surface: 'accent' }),
    sawsoSection(defs, 'text-block', 'Overview', { heading: copy.heading, body: paragraphs(copy.paragraphs) }),
  ]
}
function sawsoPrograms(defs: CorePageDefinition[], sector: string): SectionInstance[] {
  const source = sectorSources[sector]!,
    copy = SAWSO_APPROVED.pages[(source + '-programs') as keyof typeof SAWSO_APPROVED.pages] as {
      cards: readonly { title: string; paragraphs: readonly string[] }[]
      support: {
        heading: string
        paragraphs: readonly string[]
        links: readonly { label: string; url: string }[]
      } | null
    }
  const cards = copy.cards.map((c, i) => ({ key: 'i' + (i + 1), title: c.title, description: c.paragraphs.join(' ') }))
  const help = sawsoSection(defs, 'icon-cards', 'How we help', {
    heading: 'How we help',
    cards: { items: cards.map(c => c.key) },
    ...Object.fromEntries(
      cards.flatMap(c => [
        [`cards__${c.key}__icon`, 'heart'],
        [`cards__${c.key}__title`, c.title],
        [`cards__${c.key}__description`, c.description],
      ]),
    ),
  })
  const support = copy.support
  return [
    help,
    ...(support
      ? [
          sawsoSection(
            defs,
            'cta-band',
            'Support band',
            {
              heading: support.heading,
              intro: support.paragraphs.join(' '),
              action: { label: support.links[0]!.label, url: 'https://give.sawso.org' },
            },
            { surface: 'accent' },
          ),
        ]
      : []),
  ]
}
/** Core scaffold creates required internal destinations; later pages build on these heads. */
export async function ensureSawsoCorePages(client: Queryable, siteId: string) {
  const defs = await corePageDefinitions(client),
    hub = SAWSO_APPROVED.pages['hub-overview']
  const specs: { slug: string; title: string; content: SectionInstance[]; note: string }[] = [
    {
      slug: '',
      title: 'Home',
      note: 'SAWSO core page scaffold',
      content: [
        sawsoSection(
          defs,
          'split-hero',
          'Home introduction',
          {
            heading: hub.heading,
            intro: hub.paragraphs[0],
            kicker: '',
            primary: { label: 'Ways we help', url: '/ways-we-help' },
            secondary: { label: 'Newsroom', url: '/newsroom' },
            photo: { src: '/cms-samples/r8-landscape.png', alt: '[SAWSO hero photo] (sample)', decorative: false },
            __cms_sample_fields: ['photo'],
          },
          { surface: 'accent' },
        ),
      ],
    },
    {
      slug: 'ways-we-help',
      title: 'Ways we help',
      note: 'SAWSO core page scaffold',
      content: [
        sawsoSection(defs, 'page-header', 'Page header', { heading: 'Ways we help', intro: '' }, { surface: 'accent' }),
        sawsoSection(defs, 'text-block', 'Overview', { heading: hub.heading, body: paragraphs(hub.paragraphs) }),
      ],
    },
    {
      slug: 'newsroom',
      title: 'Newsroom',
      note: 'SAWSO core page scaffold',
      content: [
        sawsoSection(
          defs,
          'page-header',
          'Page header',
          { heading: 'Newsroom', intro: '[Newsroom stories — sample content]', __cms_sample_fields: ['intro'] },
          { surface: 'accent' },
        ),
      ],
    },
    ...STORY_SECTORS.map(sector => {
      const sections = sawsoOverview(defs, sector.id)
      if (sector.id === 'health') {
        const [help, ...support] = sawsoPrograms(defs, sector.id)
        sections.push(help!, sawsoFeed(defs, sector.id), ...support)
      }
      return {
        slug: 'ways-we-help/' + sector.id,
        title: sector.label,
        content: sections,
        note: sector.id === 'health' ? 'SAWSO Health core' : 'SAWSO core page scaffold',
      }
    }),
    ...sawsoStoryRows().map(story => ({
      slug: story.values.story_url.slice(1),
      title: story.values.title,
      note: 'SAWSO core story template',
      content: [
        sawsoSection(defs, 'story-detail', 'Story', {
          story: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [story.stableKey] } },
          __cms_sample_fields: ['story'],
        }),
      ],
    })),
  ]
  for (const spec of specs) {
    const old = (
      await client.query(
        'SELECT p.id,p.revision,v.note FROM pages p LEFT JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=$2 AND p.archived_at IS NULL',
        [siteId, spec.slug],
      )
    ).rows[0]
    if (old && !(spec.slug === '' && old.revision === '1' && old.note === 'Created from a shared page template'))
      continue
    const id =
      old?.id ??
      (await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, spec.slug, spec.title])).rows[0]!.id
    await client.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
      id,
      old?.revision ?? 0,
      JSON.stringify(spec.content),
      JSON.stringify({ title: spec.title, description: spec.title }),
      spec.note,
    ])
  }
  const nav = (
    await client.query(
      'SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
      [siteId],
    )
  ).rows[0]!
  if (nav.tree.length === 1) {
    const pages = (
      await client.query('SELECT id,slug,title FROM pages WHERE site_id=$1 AND slug=ANY($2::text[])', [
        siteId,
        ['', 'ways-we-help', 'newsroom'],
      ])
    ).rows
    const tree = ['', 'ways-we-help', 'newsroom'].map(slug => {
      const p = pages.find(p => p.slug === slug)!
      return { label: p.title, target: { type: 'page', page_id: p.id }, visible: true }
    })
    await client.query("SELECT * FROM app.save_navigation_draft($1,$2,$3,'manual')", [
      siteId,
      nav.revision,
      JSON.stringify(tree),
    ])
  }
}

export const SAWSO_NEWSROOM_INTRO =
  'See how The Salvation Army World Service Office works alongside communities around the world. Browse our latest stories, explore them by project sector, or find them on the map.'
function sawsoSplitNewsroom(defs: CorePageDefinition[]): SectionInstance {
  return sawsoSection(defs, 'story-split', 'Split View', {
    heading: 'News and Stories',
    introduction: SAWSO_NEWSROOM_INTRO,
    start_view: 'recent',
    page_size: '12',
    stories: {
      readerKey: 'stories',
      selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', maxAgeMonths: 13, limit: 200 },
    },
  })
}
export type SawsoMediaMap = Record<string, { id: string; alt_text: string; focal: { x: number; y: number } }>
const S3 = 'https://s3.amazonaws.com/usn-cache.salvationarmy.org/'
const sectorPhotos: Record<string, string> = {
  'anti-human-trafficking': '7a61b5eb-ad6f-4a9f-8e4f-b0039a3334df_pexels-photo-87293.jpeg',
  'business-economic-development': 'a85ae4bd-239b-4905-aa7d-a09398772659_guatemala.jpg',
  'capacity-building': '355741c3-7544-4b3f-a805-69dffe911c14_Picture1.png',
  'disaster-relief-recovery': 'aeb54fec-a04f-4255-906b-b1fb74139ebe_4f5d2e704f1352ac254614ff101aa2a2d.jpg',
  education: '85329232-67db-4677-a444-2901a4bc85c6_20b27deab2672cac477433fbfcab37df8.JPG',
  'family-care': '57a48e69-a1fe-4fa6-9451-3e50f2d54a31_169%20images%20Rio.png',
  health: 'dc7babdd-cb16-4b31-8977-b649ebc1cb7a_nurses.jpg',
  livelihoods: '95200ac5-4120-46ab-af82-dce3f016116b_SAWSOKapsabet-066-2.jpg',
}
export function sawsoMediaPhoto(media: SawsoMediaMap, url: string) {
  const item = media[url]
  return item
    ? {
        media_id: item.id,
        variant: 'wide',
        src: '/media/' + item.id + '/wide',
        alt: item.alt_text,
        decorative: false,
        focal: item.focal,
      }
    : { src: '/cms-samples/r8-landscape.png', alt: '[SAWSO photo — sample content]', decorative: false }
}
const markdown = (value: string) => escape(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
const para = (value: string) =>
  value
    .split('\n\n')
    .filter(Boolean)
    .map(p => '<p>' + markdown(p) + '</p>')
    .join('')
function repeated(items: Record<string, unknown>[], name = 'cards') {
  return {
    [name]: { items: items.map((_, i) => 'i' + (i + 1)) },
    ...Object.fromEntries(
      items.flatMap((item, i) =>
        Object.entries(item).map(([key, value]) => [name + '__i' + (i + 1) + '__' + key, value]),
      ),
    ),
  }
}
function sawsoPhotoGrid(defs: CorePageDefinition[], media: SawsoMediaMap) {
  return sawsoSection(defs, 'photo-grid', 'Ways We Help', {
    heading: 'Ways We Help',
    link: { label: '', url: '' },
    ...repeated(
      [
        'anti-human-trafficking',
        'business-economic-development',
        'capacity-building',
        'disaster-relief-recovery',
        'education',
        'family-care',
        'health',
        'livelihoods',
      ]
        .map(id => STORY_SECTORS.find(s => s.id === id)!)
        .map(sector => ({
          title: sector.label,
          photo: sawsoMediaPhoto(media, S3 + sectorPhotos[sector.id]),
          action: { label: sector.label, url: '/ways-we-help/' + sector.id },
        })),
    ),
    ...(Object.keys(media).length ? {} : { __cms_sample_fields: ['cards'] }),
  })
}
function newsroom(defs: CorePageDefinition[], home = false) {
  return sawsoSection(defs, 'newsroom', 'News and Stories', {
    heading: home ? 'News and Stories' : '',
    page_heading: home ? '' : 'News and Stories',
    intro: SAWSO_HOME_APPROVED.sections['News and Stories (link: View Newsroom)'].split('\n')[0],
    link: { label: 'View Newsroom', url: '/newsroom' },
    stories: {
      readerKey: 'stories',
      selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', limit: 200 },
    },
    filters: '',
    paging: '',
    empty_line: 'Check back soon for stories from our [sector] work.',
    home: home ? 'home' : 'newsroom',
  })
}
function completeSawsoPages(defs: CorePageDefinition[], media: SawsoMediaMap = {}): Map<string, SectionInstance[]> {
  const result = new Map<string, SectionInstance[]>(),
    hub = SAWSO_APPROVED.pages['hub-overview'],
    copy = SAWSO_HOME_APPROVED.sections
  const slides = copy['Hero slides'].split('\n').map(line => {
    const m = /^\d\. \*\*([^*]+)\*\* (.+) Buttons: (.+)$/.exec(line)
    if (!m) throw new Error('Review the approved homepage slides.')
    return { title: m[1]!, intro: m[2]!, buttons: m[3]!.split(' · ') }
  })
  const slideStories = [
    SAWSO_APPROVED.feed.stories.find(s => s.title.includes('Rio')),
    SAWSO_APPROVED.feed.stories.find(s => s.title.includes('Devastating Floods in Nepal')),
    SAWSO_APPROVED.feed.stories.find(s => s.title === 'Life in Ukraine, Years into War'),
  ]
  const hero = sawsoSection(
    defs,
    'feature-slider',
    'Featured stories',
    migrateHeroSlides({
      heading: 'The Salvation Army World Service Office',
      ...Object.fromEntries(
        slides.flatMap((slide, i) => {
          const n = i + 1,
            story = slideStories[i]!,
            path = '/stories/' + new URL(story.link).pathname.split('/').at(-1)
          return [
            ['title' + n, slide.title],
            ['intro' + n, slide.intro],
            ['photo' + n, sawsoMediaPhoto(media, story.image)],
            ['primary' + n, { label: slide.buttons[0], url: i === 2 ? path : 'https://give.sawso.org' }],
            ['secondary' + n, { label: slide.buttons[1], url: i === 2 ? 'https://give.sawso.org' : path }],
          ]
        }),
      ),
      ...(Object.keys(media).length ? {} : { __cms_sample_fields: ['photo1', 'photo2', 'photo3'] }),
    }),
  )
  const impact = sawsoSection(defs, 'feature-tiles', 'What We Do', {
    heading: 'What We Do',
    link: { label: 'Ways We Help', url: '/ways-we-help' },
    intro: '',
    ...repeated(
      copy['What We Do (link: Ways We Help)'].split('\n').map((line, i) => ({
        title: '',
        body: '<p>' + markdown(line.slice(2)) + '</p>',
        icon: ['handshake', 'users', 'globe', 'globe-outline', 'flag'][i],
      })),
    ),
  })
  const [about, why] = copy['About us'].split('### Why SAWSO?\n')
  const aboutBlock = sawsoSection(defs, 'text-block', 'About us', {
    heading: 'About us',
    body: para(about!.trim()) + '<h3>Why SAWSO?</h3>' + para(why!.trim()),
  })
  const visionLines = copy.Vision.split('\n'),
    vision = sawsoSection(defs, 'feature-tiles', 'Vision', {
      heading: 'Vision',
      link: { label: '', url: '' },
      intro: para(visionLines[0]!),
      ...repeated(
        visionLines.slice(1).map((line, i) => ({
          title: '',
          body: para(line.slice(2)),
          icon: ['lightbulb', 'network', 'dollar-sign', 'handshake'][i],
        })),
      ),
    })
  const steps = copy['How We Meet Global Needs'].split('\n').map(line => {
    const m = /^\d\. \*\*([^*]+)\*\* (.+)$/.exec(line)!
    return { title: m[1]!, body: para(m[2]!) }
  })
  const needs = sawsoSection(defs, 'numbered-steps', 'How We Meet Global Needs', {
    heading: 'How We Meet Global Needs',
    link: { label: '', url: '' },
    photo_note: '[Global needs illustration — sample content]',
    photo: {
      src: '/cms-themes/sawso/global-needs-process.svg',
      alt: '[Global needs illustration — sample content]',
      decorative: false,
    },
    ...repeated(steps),
    __cms_sample_fields: ['photo'],
  })
  const band = sawsoSection(
    defs,
    'link-band',
    'More information',
    repeated(
      copy['Red link band'].split(' · ').map((label, i) => ({
        action: { label, url: ['/annual-reports', '/financial-accountability', '/our-team'][i] },
      })),
      'links',
    ),
  )
  const contactLines = copy['Contact Us'].split('\n'),
    contacts = contactLines.map(line => {
      const m = /^- \*\*([^*]+):\*\* (.+)$/.exec(line)!
      const title = m[1]!,
        body = m[2]!.split(' · button: ')[0]!,
        button = m[2]!.split(' · button: ')[1],
        escaped = markdown(body),
        formatted = (
          title === 'Mail' ? escaped.replace(', 615 Slaters Lane, ', ',<br> 615 Slaters Lane,<br> ') : escaped
        )
          .replace(/([A-Za-z0-9.]+@[A-Za-z0-9.]+)/g, '<a href="mailto:$1">$1</a>')
          .replace(/ · /g, '<br>')
      return {
        title,
        body: '<p>' + formatted + '</p>',
        action: {
          label: button ?? '',
          url: button
            ? title === 'Media'
              ? 'mailto:mediarelations@salvationarmyusa.org'
              : 'https://give.sawso.org'
            : '',
        },
      }
    })
  const contact = sawsoSection(defs, 'contact-cards', 'Contact Us', {
    heading: 'Contact Us',
    link: { label: '', url: '' },
    ...repeated(contacts),
    __cms_anchor: 'contact',
  })
  result.set('', [
    hero,
    impact,
    aboutBlock,
    vision,
    sawsoPhotoGrid(defs, media),
    newsroom(defs, true),
    needs,
    band,
    contact,
  ])
  const hubPhoto = S3 + '9b4a829d-5296-46f8-ad2f-e1e16012c4f2_f3c86dbdefc431c824a404b373d4ac26a.JPG'
  result.set('ways-we-help', [
    sawsoSection(defs, 'photo-banner', 'Ways We Help', {
      heading: 'Ways We Help',
      size: 'short',
      kicker: '',
      intro: '',
      photo: sawsoMediaPhoto(media, hubPhoto),
      primary: { label: '', url: '' },
      secondary: { label: '', url: '' },
      ...(media[hubPhoto] ? {} : { __cms_sample_fields: ['photo'] }),
    }),
    sawsoSection(defs, 'text-block', 'Overview', {
      heading: hub.heading,
      body:
        paragraphs(hub.paragraphs) +
        SAWSO_APPROVED.pages['hub-programs'].guidance
          .map(c => '<h3>' + escape(c.heading) + '</h3>' + paragraphs(c.paragraphs))
          .join(''),
    }),
    sawsoPhotoGrid(defs, media),
    sawsoSection(
      defs,
      'cta-band',
      'Support band',
      {
        heading: copy['Ways We Help (photo grid; titles and hover lines)'].split('- Ways to Give: ')[1]!.trim(),
        intro: SAWSO_APPROVED.pages['health-programs'].support!.paragraphs[0],
        action: { label: 'Donate Today', url: 'https://give.sawso.org' },
      },
      { surface: 'primary' },
    ),
  ])
  for (const sector of STORY_SECTORS) {
    const [, overview] = sawsoOverview(defs, sector.id),
      program = SAWSO_APPROVED.pages[
        (sectorSources[sector.id] + '-programs') as keyof typeof SAWSO_APPROVED.pages
      ] as (typeof SAWSO_APPROVED.pages)['health-programs'],
      support = program.support
    const heroPhoto = S3 + sectorPhotos[sector.id],
      banner = sawsoSection(defs, 'photo-banner', 'Sector introduction', {
        heading: sector.label,
        kicker: 'Ways We Help',
        intro: '',
        photo: sawsoMediaPhoto(media, heroPhoto),
        primary: { label: support?.links[0]?.label ?? '', url: support ? 'https://give.sawso.org' : '' },
        secondary: { label: sector.id === 'family-care' ? '' : 'Stories', url: '#' + sector.id + '-stories' },
        ...(media[heroPhoto] ? {} : { __cms_sample_fields: ['photo'] }),
      })
    const help = sawsoSection(defs, 'feature-tiles', 'How we help', {
      heading: 'How We Help',
      link: { label: '', url: '' },
      intro: '',
      ...repeated(
        program.cards.map((card, i) => ({
          title: card.title,
          body: paragraphs(card.paragraphs),
          icon: ['home', 'shield', 'bolt'][i % 3],
        })),
      ),
      __cms_anchor: sector.id + '-approach',
    })
    const feed = sector.id === 'family-care' ? null : sawsoFeed(defs, sector.id)
    if (feed) feed.values.__cms_anchor = sector.id + '-stories'
    if (sector.id === 'disaster-relief-recovery') feed!.values.heading = 'Stories about disaster relief and recovery'
    const nav = sawsoSection(defs, 'on-page-navigation', 'Jump links', {
      heading: '',
      links: { items: feed ? ['i1', 'i2', 'i3'] : ['i1', 'i3'] },
      links__i1__action: { label: 'How we help', url: '#' + sector.id + '-approach' },
      links__i2__action: { label: 'Stories', url: '#' + sector.id + '-stories' },
      links__i3__action: { label: 'Support this work', url: '#' + sector.id + '-give' },
    })
    const supportSections = support
      ? [
          sawsoSection(
            defs,
            'cta-band',
            'Support band',
            {
              heading: support.heading,
              intro: support.paragraphs.join(' '),
              action: { label: support.links[0]!.label, url: 'https://give.sawso.org' },
              __cms_anchor: sector.id + '-give',
            },
            { surface: 'primary' },
          ),
        ]
      : []
    result.set('ways-we-help/' + sector.id, [banner, nav, overview!, help, ...(feed ? [feed] : []), ...supportSections])
  }
  result.set('newsroom', [sawsoSplitNewsroom(defs)])
  for (const story of sawsoStoryRows()) {
    const more = sawsoFeed(defs, story.values.tags.split(',')[0]!, 3, story.stableKey)
    more.values.heading = 'More stories'
    result.set(story.values.story_url.slice(1), [
      sawsoSection(defs, 'story-detail', 'Story', {
        story: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [story.stableKey] } },
      }),
      more,
    ])
  }
  for (const [slug, title] of [
    ['annual-reports', 'Annual Reports'],
    ['financial-accountability', 'Financial Accountability'],
    ['our-team', 'Meet Our Team'],
    ['privacy', 'Privacy Policy'],
  ])
    result.set(slug!, [
      sawsoSection(defs, 'page-header', title!, { heading: title, intro: '' }),
      sawsoSection(defs, 'text-block', title!, {
        heading: '',
        body: '<p>[' + title + ' — sample content. Approved content needed.]</p>',
        __cms_sample_fields: ['body'],
      }),
    ])
  return result
}
export async function ensureSawsoPublicPages(
  client: Queryable,
  siteId: string,
  media: SawsoMediaMap = {},
  refreshGenerated = false,
) {
  const defs = await corePageDefinitions(client),
    specs = completeSawsoPages(defs, media)
  for (const [slug, content] of specs) {
    let old = (
      await client.query(
        'SELECT p.id,p.revision,v.note,v.meta,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=$2 AND p.archived_at IS NULL',
        [siteId, slug],
      )
    ).rows[0]
    if (!old) {
      const title = String(content[0]?.values.heading ?? slug),
        id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, slug, title])).rows[0]!.id
      old = { id, revision: 0, note: 'SAWSO core page scaffold', meta: { title, description: title } }
    }
    if (
      ![
        'SAWSO core page scaffold',
        'SAWSO Health core',
        'SAWSO core story template',
        ...(refreshGenerated ? ['SAWSO approved public pages'] : []),
      ].includes(old.note)
    )
      continue
    if (isDeepStrictEqual(old.content, content)) continue
    await client.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
      old.id,
      old.revision,
      JSON.stringify(content),
      JSON.stringify(old.meta),
      'SAWSO approved public pages',
    ])
  }
}
