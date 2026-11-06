/** Shared national-look sections. Fields remain ordinary editable CMS values. */
import type { SlotDef } from '@cms/schema'
import { sourceSampleValues, MATERIAL_ICON_PRESENTATION } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
import type { SeedSectionDef, LegacySeedSectionDef } from './index.ts'
const text = (id: string, label: string): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: {
    sourceSample: ['heading', 'title'].includes(id)
      ? '[Heading — sample content]'
      : id === 'intro'
        ? '[Introduction — sample content]'
        : '',
  },
})
const rich = (id: string, label: string): SlotDef => ({ ...text(id, label), kind: 'richtext' })
const photo = (id = 'photo'): SlotDef => ({
  id,
  kind: 'image',
  label: 'Photo',
  constraints: {
    sourceSample: { src: '/cms-samples/r8-landscape.png', alt: '[Photo — sample content]', decorative: false },
  },
})
const link = (id: string, label: string, kind: 'link' | 'button' = 'link'): SlotDef => ({
  id,
  kind,
  label,
  constraints: { sourceSample: { label: '[Link — sample content]', url: '#next' } },
})
const repeat = (id: string, fields: SlotDef[]): SlotDef => ({
  id,
  kind: 'repeat',
  label: 'Cards',
  constraints: {
    item: {
      unit: 'Card',
      min: 0,
      max: 12,
      fields,
      samples: [
        {
          title: '[Card title — sample content]',
          body: '<p>[Card text — sample content]</p>',
          icon: 'heart',
          action: { label: '[Link — sample content]', url: '#next' },
        },
      ],
    },
  },
})
const nationalSectionCss = `.national-block{padding:3rem 1.25rem;font-family:var(--font-body);color:var(--color-ink)}
.national-block-head{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;margin:0 12px 20px}.national-block-head h2{margin:0}.national-block-head a{color:var(--color-muted);text-decoration:none}.national-card{padding:32px;border-radius:20px;background:var(--color-surface)}.national-lede{max-width:860px;margin-bottom:24px}.national-lede:empty{display:none}.national-sr{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden}
.national-hero{position:relative;display:flex;align-items:flex-end;min-height:440px;border-radius:20px;overflow:hidden;isolation:isolate;background:var(--color-ink)}.national-hero[data-size="short"]{min-height:340px}.national-hero>img,.national-hero>cms-slot{position:absolute;inset:0;width:100%;height:100%;z-index:-2;object-fit:cover}.national-hero>cms-slot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.national-hero:after{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(to top,#0009 0%,#0000001f 50%,transparent 72%),linear-gradient(to right,#0005,transparent 58%)}.national-hero-copy{padding:0 40px 48px;max-width:720px;color:white}.national-hero-copy h1,.national-hero-copy h2{color:inherit;font-family:var(--font-heading);font-size:44px;line-height:1.2;margin:0 0 10px}.national-hero-copy p{margin:0 0 18px}.national-hero-copy p:empty{display:none}.national-actions{display:flex;flex-wrap:wrap;gap:12px}.national-block-head a:empty,.national-actions a:empty{display:none}.national-actions a{display:inline-flex;padding:15px 35px;border-radius:8px;text-decoration:none}.national-slider{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;border-radius:20px}.national-slider>.national-hero{flex:0 0 100%;scroll-snap-align:start}.national-slide-controls{position:absolute;right:24px;bottom:24px;display:flex;gap:4px}.national-slide-controls a{padding:5px;background:white;color:var(--color-ink);border-radius:50%;text-decoration:none}
.national-tiles,.national-contacts,.national-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.national-tiles:has(>.national-tile:nth-child(4):last-child){grid-template-columns:repeat(4,minmax(0,1fr))}.national-tiles:has(>.national-tile:nth-child(5):last-child){grid-template-columns:repeat(5,minmax(0,1fr))}.national-tile{padding:24px;background:var(--color-surfaceAlt);border-radius:12px;overflow-wrap:anywhere}.national-tile h3{font:700 19px/1.35 var(--font-body);margin:14px 0 8px}.national-tile h3:empty{display:none}.national-tile p{margin:0;font-size:16px}.national-icon{display:grid;place-items:center;width:56px;height:56px;background:var(--color-accent);color:var(--color-accentContrast);border-radius:50%}.national-photo-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.national-photo-tile{position:relative;aspect-ratio:4/3;overflow:hidden;border-radius:12px}.national-photo-tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.national-photo-tile h3{position:absolute;inset:auto 0 0;margin:0;padding:56px 16px 16px;background:linear-gradient(to top,#000c,transparent);color:white;font:700 17px/1.35 var(--font-body)}.national-photo-tile a{position:absolute;inset:0;font-size:0;color:transparent}.national-photo-tile{outline:3px solid transparent;outline-offset:2px;transition:outline-color .15s}.national-photo-tile img{transition:transform .25s}.national-photo-tile:has(a:focus-visible){outline-color:var(--color-primary)}.national-photo-tile:has(a:focus-visible) img{transform:scale(1.03)}@media(hover:hover) and (pointer:fine){.national-photo-tile:hover{outline-color:var(--color-primary)}.national-photo-tile:hover img{transform:scale(1.03)}}@media(prefers-reduced-motion:reduce){.national-photo-tile,.national-photo-tile img{transition:none}}.national-process-picture{max-width:360px;margin:0 auto 28px}.national-process-picture figcaption{font-size:13px;text-align:center}.national-steps{list-style:none;counter-reset:step;padding:0;margin:0}.national-steps>li{counter-increment:step}.national-steps>li:before{content:counter(step);display:grid;place-items:center;width:36px;height:36px;margin-bottom:32px;border-radius:50%;background:var(--color-primary);color:var(--color-primaryContrast)}.national-link-band{display:flex;gap:16px;padding:32px;background:var(--color-primary);border-radius:20px}.national-link-band>a{flex:1;text-align:center}.national-contacts{text-align:center}
@media(max-width:1199px){.national-photo-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:991px){.national-tiles,.national-tiles:has(>.national-tile:nth-child(4):last-child),.national-tiles:has(>.national-tile:nth-child(5):last-child){grid-template-columns:repeat(2,minmax(0,1fr))}.national-photo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.national-contacts,.national-steps{grid-template-columns:1fr}}
@media(max-width:575px){.national-hero{min-height:420px;border-radius:12px}.national-hero-copy{padding:0 20px 28px}.national-hero-copy h1,.national-hero-copy h2{font-size:30px}.national-block-head{flex-direction:column;align-items:flex-start;gap:6px}.national-card{padding:20px;border-radius:12px}.national-tiles,.national-tiles:has(>.national-tile:nth-child(4):last-child),.national-tiles:has(>.national-tile:nth-child(5):last-child){grid-template-columns:1fr}.national-photo-grid{gap:10px}.national-photo-tile h3{padding:32px 12px 12px;font-size:15px}.national-link-band{flex-direction:column;padding:24px;border-radius:12px}}
`
const caps = {
  background: true,
  width: true,
  spacing: true,
  alignment: false,
  imagePosition: false,
  phoneOrder: false,
  buttonStyle: true,
}
const head = '<div class="national-block-head"><h2>{{heading}}</h2>{{link}}</div>'
function block(slug: string, name: string, body: string, slots: SlotDef[], cls = '', extraCss = ''): CoreSection {
  const annotated = slots.map((slot, i) =>
    i
      ? slot
      : {
          ...slot,
          constraints: {
            ...slot.constraints,
            coreCapabilities: caps,
            corePurpose: 'Present ' + name.toLowerCase() + ' with a shared national layout and editable content.',
            coreLibrary: 'r8',
          },
        },
  )
  const definition: SeedSectionDef = {
    kind: 'legacy',
    slug: 'core-' + slug,
    name,
    category: 'National sections',
    sourceHtml: '<section class="core national-block ' + cls + '">' + body + '</section>',
    sourceCss:
      '.national-block{box-sizing:border-box}.national-block *{box-sizing:border-box;min-width:0}.national-block img{display:block;width:100%;height:auto}.national-block h1,.national-block h2,.national-block h3{overflow-wrap:break-word}' +
      nationalSectionCss +
      extraCss,
    slots: annotated,
    changelog: 'Shared national-look sections with ordinary editable fields.',
  }
  return {
    definition,
    purpose: 'Present ' + name.toLowerCase() + ' with a shared national layout and editable content.',
    capabilities: caps,
    samples: sourceSampleValues(annotated),
  }
}
const tileFields = [
  { ...text('icon', 'Icon'), constraints: { presentation: MATERIAL_ICON_PRESENTATION } },
  text('title', 'Title'),
  rich('body', 'Text'),
]
const slideChoice = (
  id: string,
  label: string,
  choices: { value: string; label: string }[],
  value: string,
): SlotDef => ({ ...text(id, label), constraints: { choices, sourceSample: value } })
const slideParityFields: SlotDef[] = [
  slideChoice(
    'position',
    'Text position',
    [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ],
    'left',
  ),
  slideChoice(
    'shade',
    'Shade behind the text',
    [
      { value: 'blue', label: 'Black to blue' },
      { value: 'black', label: 'Black' },
      { value: 'white', label: 'White' },
      { value: 'none', label: 'None' },
    ],
    'blue',
  ),
  {
    ...photo('phone_photo'),
    label: 'Phone photo',
    constraints: { sourceSample: { src: '', alt: '', decorative: false } },
  },
  ...['phone_photo_enabled', 'primary_visible', 'secondary_visible', 'scheduled'].map(id =>
    slideChoice(
      id,
      id === 'phone_photo_enabled'
        ? 'Different picture on phones'
        : id === 'scheduled'
          ? 'Schedule this slide'
          : id === 'primary_visible'
            ? 'Show main button'
            : 'Show second button',
      [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      id.endsWith('_visible') ? 'on' : 'off',
    ),
  ),
  ...['primary_color', 'secondary_color'].map((id, index) =>
    slideChoice(
      id,
      index ? 'Second button color' : 'Main button color',
      [
        { value: 'red', label: 'Red' },
        { value: 'white', label: 'White' },
        { value: 'outline', label: 'Outline' },
      ],
      index ? 'white' : 'red',
    ),
  ),
]
const slideFields = [
  photo(),
  text('title', 'Title'),
  {
    ...text('intro', 'Introduction'),
    constraints: { sourceSample: '[Slide description — sample content]', multiline: true },
  },
  link('primary', 'Main button', 'button'),
  link('secondary', 'Second button', 'button'),
]
export const NATIONAL_LIBRARY: readonly CoreSection[] = [
  block(
    'photo-banner',
    'Photo banner',
    '<div class="national-hero" data-size="{{size}}">{{photo}}<div class="national-hero-copy"><p class="national-kicker">{{kicker}}</p><h1>{{heading}}<span class="national-report-subheading">{{subheading}}</span></h1><p class="national-intro">{{intro}}</p><div class="national-actions">{{primary}}{{secondary}}</div><div class="national-report-caption">{{caption}}</div></div></div>',
    [
      {
        ...text('size', 'Height'),
        constraints: {
          sourceSample: 'standard',
          choices: [
            { value: 'standard', label: 'Standard' },
            { value: 'short', label: 'Short' },
          ],
        },
      },
      text('heading', 'Heading'),
      text('kicker', 'Short introduction'),
      text('intro', 'Introduction'),
      photo(),
      link('primary', 'Main button', 'button'),
      link('secondary', 'Second button', 'button'),
      { ...text('subheading', 'Second heading line'), constraints: { sourceSample: '', reportOnly: true } },
      { ...rich('caption', 'Photo caption'), constraints: { sourceSample: '', reportOnly: true } },
    ],
    'national-opener',
  ),
  block(
    'feature-slider',
    'Feature slider',
    [
      '<h1 class="national-sr">{{heading}',
      '}',
      '</h1><div class="national-slider cms-hero-slider" aria-label="Featured stories" data-hero-auto="{{auto_change}}" data-hero-seconds="{{seconds}}">{{#slides}',
      '}',
      '<article class="national-hero cms-hero-slide" data-hero-enabled="{{enabled}}" data-hero-starts="{{starts_at}}" data-hero-ends="{{ends_at}}" data-hero-choice-position="{{position}}" data-hero-choice-shade="{{shade}}" data-hero-choice-phone_photo_enabled="{{phone_photo_enabled}}" data-hero-choice-primary_visible="{{primary_visible}}" data-hero-choice-secondary_visible="{{secondary_visible}}" data-hero-choice-scheduled="{{scheduled}}" data-hero-choice-primary_color="{{primary_color}}" data-hero-choice-secondary_color="{{secondary_color}}" >{{photo}',
      '}',
      '<div class="cms-hero-phone-picture">{{phone_photo}',
      '}',
      '</div><div class="national-hero-copy"><h2>{{title}',
      '}',
      '</h2><p>{{intro}',
      '}',
      '</p><div class="national-actions"><span class="cms-hero-main">{{primary}',
      '}',
      '</span><span class="cms-hero-second">{{secondary}',
      '}',
      '</span></div></div></article>{{/slides}',
      '}',
      '</div>',
    ].join(''),
    [
      text('heading', 'Page heading'),
      {
        id: 'auto_change',
        kind: 'text',
        label: 'Change slides automatically',
        constraints: {
          presentation: true,
          choices: [
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
        },
      },
      { id: 'seconds', kind: 'text', label: 'Seconds per slide', constraints: { presentation: true } },
      {
        id: 'slides',
        kind: 'repeat',
        label: 'Hero slides',
        constraints: {
          heroSlides: true,
          heroEditingParity: true,
          item: {
            unit: 'Slide',
            min: 0,
            max: 48,
            fields: [
              ...slideFields,
              ...slideParityFields,
              {
                ...text('enabled', 'Show this slide'),
                constraints: {
                  choices: [
                    { value: 'on', label: 'On' },
                    { value: 'off', label: 'Off' },
                  ],
                  sourceSample: 'on',
                },
              },
              { ...text('starts_at', 'Start'), constraints: { input: 'date-time', sourceSample: '' } },
              { ...text('ends_at', 'End'), constraints: { input: 'date-time', sourceSample: '' } },
            ],
            samples: [
              {
                title: '[Slide heading — sample content]',
                intro: '[Slide description — sample content]',
                photo: { src: '/cms-samples/r8-landscape.png', alt: '[Photo — sample content]', decorative: false },
                primary: { label: '[Main button — sample content]', url: '#next' },
                secondary: { label: '', url: '' },
                enabled: 'on',
                starts_at: '',
                ends_at: '',
              },
            ],
          },
        },
      },
    ],
    'national-opener',
  ),
  block(
    'feature-tiles',
    'Feature tiles',
    head +
      '<div class="national-card"><div class="national-lede">{{intro}}</div><div class="national-tiles">{{#cards}}<article class="national-tile"><span class="national-icon">{{icon}}</span><h3>{{title}}</h3><div>{{body}}</div></article>{{/cards}}</div></div>',
    [
      text('heading', 'Heading'),
      link('link', 'Heading link'),
      rich('intro', 'Introduction'),
      repeat('cards', tileFields),
    ],
  ),
  block(
    'photo-grid',
    'Photo grid',
    head +
      '<div class="national-card"><div class="national-photo-grid">{{#cards}}<article class="national-photo-tile">{{photo}}<h3>{{title}}</h3>{{action}}</article>{{/cards}}</div></div>',
    [
      text('heading', 'Heading'),
      link('link', 'Heading link'),
      repeat('cards', [photo(), text('title', 'Title'), link('action', 'Link')]),
    ],
  ),
  block(
    'numbered-steps',
    'Numbered steps',
    head +
      '<div class="national-card"><figure class="national-process-picture">{{photo}}<figcaption>{{photo_note}}</figcaption></figure><ol class="national-steps">{{#cards}}<li class="national-tile"><h3>{{title}}</h3><div>{{body}}</div></li>{{/cards}}</ol></div>',
    [
      text('heading', 'Heading'),
      link('link', 'Heading link'),
      photo(),
      text('photo_note', 'Photo note'),
      repeat('cards', [text('title', 'Title'), rich('body', 'Text')]),
    ],
  ),
  block(
    'link-band',
    'Link band',
    '<nav class="national-link-band" aria-label="Related information">{{#links}}{{action}}{{/links}}</nav>',
    [repeat('links', [link('action', 'Link', 'button')])],
  ),
  block(
    'contact-cards',
    'Contact cards',
    head +
      '<div class="national-card"><div class="national-contact-layout"><figure class="national-contact-photo">{{photo}}</figure><div class="national-contact-copy"><div class="national-contacts">{{#cards}}<article class="national-tile"><h3>{{title}}</h3><div>{{body}}</div><div class="national-actions">{{action}}</div></article>{{/cards}}</div><div class="national-contact-extra">{{extra}}</div><div class="national-contact-questions">{{questions}}</div></div></div><div class="national-contact-small">{{small}}</div></div><span class="report-page-link-label" hidden>{{page_link_label}}</span>',
    [
      text('heading', 'Heading'),
      link('link', 'Heading link'),
      repeat('cards', [text('title', 'Title'), rich('body', 'Text'), link('action', 'Button', 'button')]),
      { id: 'photo', kind: 'image', label: 'Photo', constraints: { sourceSample: '', reportOnly: true } },
      ...['extra', 'questions', 'small'].map(id => ({
        ...rich(id, id === 'extra' ? 'Additional giving' : id === 'questions' ? 'Questions' : 'Small print'),
        constraints: { sourceSample: '', reportOnly: true },
      })),
      { ...text('page_link_label', 'Page link label'), constraints: { sourceSample: '', reportOnly: true } },
    ],
    '',
    '.national-contact-layout,.national-contact-copy{display:contents}',
  ),
]
const brand = '<a class="national-brand" href="/">{{logo}}<span><b>{{name}}</b><span>{{tagline}}</span></span></a>'
export const NATIONAL_HEADER: LegacySeedSectionDef = {
  kind: 'legacy',
  slug: 'national-header',
  name: 'National header',
  category: 'Site frame',
  sourceHtml:
    '<div class="national-header-row">' +
    brand +
    '<nav class="national-desktop-nav" aria-label="Main">{{menu}}</nav>{{secondary}}{{donate}}<details class="national-phone-menu"><summary aria-label="Menu">☰</summary><nav aria-label="Phone menu">{{menu}}</nav></details></div>',
  sourceCss: [
    '.national-header-row{display:flex;align-items:center;gap:24px;padding:12px 24px}',
    '.national-brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}',
    '.national-brand img{width:42px;height:48px;object-fit:contain;flex:none}',
    '.national-brand>span{display:flex;flex-direction:column;line-height:1.15}',
    '.national-brand b{font-family:var(--font-heading);font-variant:small-caps;font-size:19px;font-weight:400;white-space:nowrap}',
    '.national-brand>span>span{font-family:var(--font-heading);font-variant:small-caps;font-size:13px;color:#61769c}',
    '.national-desktop-nav{flex:1;display:flex;justify-content:center}',
    '.national-desktop-nav>.cms-nav-list{width:auto}',
    '.national-desktop-nav>.cms-nav-list{display:flex;align-items:center;gap:4px;margin:0;padding:0;list-style:none}',
    '.national-desktop-nav a{display:flex;align-items:center;padding:10px 14px;color:inherit;text-decoration:none;font-weight:400;border-radius:8px}',
    '.national-desktop-nav a:hover{background:#f2f2f2}',
    '.national-desktop-nav .cms-nav-item{position:relative}',
    '.national-desktop-nav .cms-nav-submenu{display:none;position:absolute;left:0;top:100%;width:18rem;padding:8px;margin:0;list-style:none;background:white;border-radius:12px;box-shadow:0 12px 32px #1c1b1f24;z-index:70}',
    '.national-desktop-nav .cms-nav-item:hover>.cms-nav-submenu,.national-desktop-nav .cms-nav-item:focus-within>.cms-nav-submenu{display:block}',
    '.national-desktop-nav .cms-nav-submenu a{display:block;font-size:15px;padding:10px 14px}',
    '.national-desktop-nav .cms-nav-item-parent>a{display:flex;align-items:center;gap:6px}',
    '.national-desktop-nav .cms-nav-item-parent>a:after{content:"";width:6px;height:6px;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(45deg);margin:0 0 3px 3px}',
    '.national-header-row>.cms-button{padding:12px 20px;font-weight:700;line-height:21px}',
    '.national-phone-menu{display:none}',
    '@media(max-width:991px){.national-header-row{gap:12px}',
    '.national-desktop-nav,.national-header-row>.cms-button{display:none}',
    '.national-phone-menu{display:block;margin-left:auto}',
    '.national-phone-menu>summary{display:grid;place-items:center;list-style:none;width:44px;height:44px;background:#f2f2f2;border-radius:8px;cursor:pointer}',
    '.national-phone-menu[open]>nav{position:absolute;left:0;right:0;top:100%;padding:16px;background:white;border-radius:0 0 12px 12px;box-shadow:0 12px 32px #1c1b1f24}',
    '.national-phone-menu ul{list-style:none;padding:0}',
    '.national-phone-menu a{display:block;padding:10px;color:inherit}',
    '.national-phone-menu .cms-nav-submenu{padding-left:16px;position:static;box-shadow:none;display:block}',
    '.national-brand b{font-size:16px}',
    '.national-brand>span>span{font-size:11px}',
    '.national-brand img{width:34px;height:40px}',
    '}',
  ].join(''),
  slots: [
    {
      id: 'logo',
      kind: 'image',
      label: 'Logo',
      constraints: {
        siteLogo: true,
        sourceSample: {
          src: '/cms-themes/sawso/salvation-army-shield.svg',
          alt: 'The Salvation Army',
          decorative: false,
        },
      },
    },
    text('name', 'Name'),
    text('tagline', 'Tagline'),
    { id: 'menu', kind: 'navigation', label: 'Site menu', constraints: {} },
    link('donate', 'Donate', 'button'),
    link('secondary', 'Second button', 'button'),
  ],
  changelog: 'National header with the owner-approved shield and a no-script phone menu.',
}
export const NATIONAL_FOOTER: LegacySeedSectionDef = {
  kind: 'legacy',
  slug: 'national-footer',
  name: 'National footer',
  category: 'Site frame',
  sourceHtml:
    '<div class="national-footer-top">' +
    brand +
    '<b>{{mission_heading}}</b><div>{{mission}}</div></div><div class="national-footer-columns"><nav aria-label="Footer">{{links}}</nav><div>{{search}}</div><div>{{address}}</div></div><div class="national-footer-disclaimer">{{disclaimer}}</div><div class="national-footer-base">{{base}}</div><nav class="national-bottom-bar" aria-label="Quick links"><a href="/">Home</a><a href="/ways-we-help">Ways We Help</a><a href="/newsroom">Newsroom</a><a href="https://give.sawso.org">Donate</a></nav>',
  sourceCss: [
    'a{color:inherit;text-decoration:none}',
    '.national-footer-top{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px}',
    '.national-footer-top>div{max-width:860px;font-size:15px}',
    '.national-footer-top p{margin:0}',
    '.national-footer-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;font-size:14px}',
    '.national-footer-columns nav p{margin:0 0 6px}',
    '.national-footer-columns>div:last-child{text-align:right}',
    '.national-footer-disclaimer{font-size:13px;text-align:center;opacity:.85;max-width:980px;margin:auto}',
    '.national-footer-base{border-top:1px solid #ffffff33;padding-top:18px;text-align:center;font-size:13px;opacity:.85}',
    '.national-footer-base p{margin:0}',
    '.national-bottom-bar{display:none}',
    '.national-brand{display:flex;align-items:center;justify-content:center;gap:12px;color:inherit;text-decoration:none}',
    '.national-brand img{width:42px;height:48px;object-fit:contain}',
    '.national-brand>span{display:flex;flex-direction:column;line-height:1.15}',
    '.national-brand b{font:400 19px var(--font-heading);font-variant:small-caps}',
    '.national-brand>span>span{font:400 13px var(--font-heading);font-variant:small-caps}',
    '.cms-site-search{display:flex}',
    '.cms-site-search input{min-width:0;width:100%;background:white;color:#1c1b1f;border:0;border-radius:8px 0 0 8px;padding:10px 12px;font:inherit}',
    '.cms-site-search button{border:0;background:#ef3e42;color:white;border-radius:0 8px 8px 0;padding:10px 16px;font:inherit}',
    '@media(max-width:991px){.national-footer-columns{grid-template-columns:1fr}',
    '.national-footer-columns>div:last-child{text-align:left}',
    '.national-bottom-bar{position:fixed;bottom:12px;left:12px;right:12px;z-index:60;display:flex;gap:4px;padding:8px 10px;background:white;color:#1c1b1f;border-radius:12px;box-shadow:0 12px 32px #1c1b1f24}',
    '.national-bottom-bar a{flex:1;display:flex;justify-content:center;padding:8px 6px;color:#1c1b1f;font-size:13px;white-space:nowrap;text-decoration:none}',
    '.national-bottom-bar a+a{border-left:1px solid #1c1b1f1a}',
    '.national-bottom-bar a:first-child{color:#ef3e42}',
    '.national-bottom-bar a:last-child{flex:none;border:0;background:#ffebeb;color:#c5000e;font-weight:700;border-radius:8px;padding:8px 16px}',
    '}',
  ].join(''),
  slots: [
    {
      id: 'logo',
      kind: 'image',
      label: 'Logo',
      constraints: {
        siteLogo: true,
        inheritHeaderLogo: true,
        sourceSample: {
          src: '/cms-themes/sawso/salvation-army-shield.svg',
          alt: 'The Salvation Army',
          decorative: false,
        },
      },
    },
    text('name', 'Name'),
    text('tagline', 'Tagline'),
    text('mission_heading', 'Mission heading'),
    rich('mission', 'Mission'),
    rich('links', 'Links'),
    { id: 'search', kind: 'text', label: 'Search', constraints: { siteWidget: 'site-search' } },
    rich('address', 'Address'),
    rich('disclaimer', 'Disclaimer'),
    rich('base', 'Legal'),
  ],
  changelog: 'National footer with the approved mission, contact text and ordinary site search.',
}
