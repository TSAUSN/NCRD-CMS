export type WorldChoice = {
  heading: string
  region: string
  main: string[]
  limit: '200' | '3' | '6' | '9' | '12' | '24'
}
const tag = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const WorldChoice = {
  parse(input: unknown): WorldChoice {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Choose valid World View settings.')
    const v = input as Record<string, unknown>
    if (
      Object.keys(v).length !== 4 ||
      typeof v.heading !== 'string' ||
      v.heading.length > 160 ||
      typeof v.region !== 'string' ||
      v.region.length > 80 ||
      (v.region !== '' && !tag.test(v.region)) ||
      !Array.isArray(v.main) ||
      v.main.length > 100 ||
      v.main.some(id => typeof id !== 'string' || id.length > 80 || !tag.test(id)) ||
      new Set(v.main).size !== v.main.length ||
      !['200', '3', '6', '9', '12', '24'].includes(String(v.limit))
    )
      throw Error('Choose valid World View settings.')
    return {
      heading: v.heading.trim(),
      region: v.region,
      main: v.main as string[],
      limit: v.limit as WorldChoice['limit'],
    }
  },
}
export function worldChoice(query: URLSearchParams): WorldChoice {
  return WorldChoice.parse({
    heading: query.get('heading') ?? 'Where We Work',
    region: query.get('region') ?? '',
    main: (query.get('main') ?? '').split(',').filter(Boolean),
    limit: query.get('limit') ?? '200',
  })
}
export function worldChoiceQuery(choice: WorldChoice) {
  const q = new URLSearchParams({
    widget: 'world',
    heading: choice.heading,
    region: choice.region,
    limit: choice.limit,
  })
  if (choice.main.length) q.set('main', choice.main.join(','))
  return q
}

export type SplitChoice = {
  heading: string
  introduction: string
  first: 'recent' | 'sectors' | 'map'
  size: '3' | '6' | '9' | '12' | '24'
}
export const SplitChoice = {
  parse(input: unknown): SplitChoice {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Choose valid Split View settings.')
    const v = input as Record<string, unknown>
    if (
      Object.keys(v).length !== 4 ||
      typeof v.heading !== 'string' ||
      v.heading.length > 160 ||
      typeof v.introduction !== 'string' ||
      v.introduction.length > 2000 ||
      !['recent', 'sectors', 'map'].includes(String(v.first)) ||
      !['3', '6', '9', '12', '24'].includes(String(v.size))
    )
      throw Error('Choose valid Split View settings.')
    return {
      heading: v.heading.trim(),
      introduction: v.introduction.trim(),
      first: v.first as SplitChoice['first'],
      size: v.size as SplitChoice['size'],
    }
  },
}
export function splitChoice(query: URLSearchParams): SplitChoice {
  return SplitChoice.parse({
    heading: query.get('heading') ?? 'News and Stories',
    introduction: query.get('introduction') ?? '',
    first: query.get('first') ?? 'recent',
    size: query.get('size') ?? '12',
  })
}
export function splitChoiceQuery(choice: SplitChoice) {
  return new URLSearchParams({
    widget: 'split',
    heading: choice.heading,
    introduction: choice.introduction,
    first: choice.first,
    size: choice.size,
  })
}
