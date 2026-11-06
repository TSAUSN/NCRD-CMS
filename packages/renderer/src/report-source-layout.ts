import { parseHtml, type HtmlElement, type HtmlNode } from './source-html.ts'

/** Reuse compiled field fragments in the supplied report's normal column structure. */
export function reportSourceStoryLayout(
  body: string,
  layout: unknown,
  hasPhoto: boolean,
  wideReading: boolean,
): string {
  if (!['response', 'reading', 'feature', 'text'].includes(String(layout)) || (layout === 'text' && hasPhoto))
    return body
  const parsed = parseHtml(body, { locations: true })
  if (!parsed.ok) return body
  const has = (node: HtmlElement, name: string) =>
    (node.attributes.find(a => a.name === 'class')?.value ?? '').split(/\s+/).includes(name)
  const find = (nodes: readonly HtmlNode[], name: string): HtmlElement | undefined => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (has(node, name)) return node
      const result = find(node.children, name)
      if (result) return result
    }
    return undefined
  }
  const article = find(parsed.nodes, 'ar-country-story')
  if (!article?.source) return body
  const grid = find(article.children, 'ar-country-grid')
  if (!grid) return body
  const get = (name: string) => find(grid.children, name),
    heading = get('ar-feature-heading'),
    copy = get('ar-copy'),
    photo = get('ar-story-figure')
  if (!heading?.source || !copy?.source || !photo?.source) return body
  const raw = (node: HtmlElement | undefined) => (node?.source ? body.slice(node.source.start, node.source.end) : '')
  const inner = (node: HtmlElement) => (node.source ? body.slice(node.source.openEnd, node.source.closeStart) : '')
  const open = (node: HtmlElement, add: string[], remove: string[]) => {
    const range = node.source!,
      before = body.slice(range.start, range.openEnd),
      attribute = node.attributes.find(a => a.name === 'class'),
      names = (attribute?.value ?? '').split(/\s+/).filter(name => name && !remove.includes(name)),
      next = [...new Set([...names, ...add])].join(' ')
    if (attribute?.valueRange)
      return (
        before.slice(0, attribute.valueRange.start - range.start) +
        next +
        before.slice(attribute.valueRange.end - range.start)
      )
    return before.replace(/^<([a-z0-9-]+)/i, '<$1 class="' + next + '"')
  }
  const note = find(photo.children, 'ar-photo-note'),
    photoInner = inner(photo),
    noteMarkup = raw(note)
  const figure =
    open(photo, [], ['ar-story-figure']) +
    (layout === 'reading' ? photoInner.replace(noteMarkup, '') : photoInner) +
    body.slice(photo.source.closeStart, photo.source.end)
  const after = get('ar-after-stats')
  const hasHeading = (nodes: readonly HtmlNode[]): boolean =>
    nodes.some(node => node.kind === 'element' && (/^h[2-4]$/.test(node.tag) || hasHeading(node.children)))
  const afterMarkup =
    after?.source && hasHeading(after.children)
      ? open(after, ['ar-fact'], []) + inner(after) + body.slice(after.source.closeStart, after.source.end)
      : raw(after)
  const statGrid = get('ar-stat-grid'),
    statCount = statGrid?.children.filter(node => node.kind === 'element' && has(node, 'ar-stat')).length ?? 0
  const facts =
    layout === 'reading' &&
    statCount > 0 &&
    after?.source &&
    !after.attributes.some(attribute => attribute.name === 'hidden')
  const factMarkup = facts
    ? open(after!, ['ar-fact'], ['ar-after-stats']) +
      inner(after!) +
      body.slice(after!.source!.closeStart, after!.source!.end)
    : ''
  const statMarkup =
    statGrid?.source && (facts || (layout === 'response' && statCount === 5))
      ? open(statGrid, [facts ? 'ar-congo-facts' : 'ar-five'], facts ? ['ar-stat-grid'] : []) +
        inner(statGrid) +
        factMarkup +
        body.slice(statGrid.source.closeStart, statGrid.source.end)
      : raw(statGrid)
  const stats = raw(get('ar-stats-heading')) + statMarkup + (facts ? '' : afterMarkup)
  const continuation = find(article.children, 'ar-story-body'),
    impact = find(article.children, 'ar-program-impact'),
    action = find(article.children, 'ar-discover')
  let content = '',
    classes: string[] = []
  if (layout === 'reading') {
    const eyebrow = find(heading.children, 'ar-eyebrow'),
      photoLead = hasPhoto && (!eyebrow || eyebrow.attributes.some(attribute => attribute.name === 'hidden'))
    classes = [
      'ar-reading-story',
      ...(wideReading ? ['ar-secondary-story'] : []),
      ...(photoLead ? ['ar-photo-led'] : []),
    ]
    content =
      (hasPhoto ? figure : '<div class="ar-reading-head">' + inner(heading) + '</div>') +
      '<div class="ar-reading-copy">' +
      (hasPhoto ? inner(heading) : '') +
      inner(copy) +
      noteMarkup +
      stats +
      '</div>' +
      raw(continuation) +
      raw(action)
  } else if (layout === 'feature') {
    classes = ['ar-feature', 'ar-report-feature']
    content =
      raw(heading) + figure + '<div class="ar-copy">' + inner(copy) + stats + '</div>' + raw(continuation) + raw(action)
  } else if (layout === 'text') {
    classes = ['ar-text-story']
    content =
      '<div class="ar-brief">' + inner(heading) + inner(copy) + '</div>' + stats + raw(continuation) + raw(action)
  } else {
    classes = ['ar-response-story']
    content =
      '<div class="ar-response-top"><div>' +
      inner(heading) +
      inner(copy) +
      '</div>' +
      figure +
      '</div>' +
      stats +
      raw(continuation) +
      raw(action)
  }
  const closing = body.slice(article.source.closeStart, article.source.end)
  return (
    body.slice(0, article.source.start) +
    open(article, classes, ['ar-country-story']) +
    content +
    closing +
    raw(impact) +
    body.slice(article.source.end)
  )
}

/** The closing quote uses the source frame, with heading and photo field wrappers intact. */
export function reportSourceClosingLayout(body: string, hasPhoto: boolean): string {
  const parsed = parseHtml(body, { locations: true })
  if (!parsed.ok) return body
  const has = (node: HtmlElement, name: string) =>
    (node.attributes.find(a => a.name === 'class')?.value ?? '').split(/\s+/).includes(name)
  const find = (nodes: readonly HtmlNode[], check: (node: HtmlElement) => boolean): HtmlElement | undefined => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (check(node)) return node
      const result = find(node.children, check)
      if (result) return result
    }
    return undefined
  }
  const root = find(parsed.nodes, node => has(node, 'core')),
    heading = root && find(root.children, node => node.tag === 'h2'),
    photo = root && find(root.children, node => has(node, 'core-report-closing-photo'))
  if (!root?.source || !heading?.source || !photo?.source) return body
  const quote = body.slice(heading.source.start, heading.source.end),
    picture = hasPhoto
      ? '<div class="core-report-closing-photo ar-photo">' +
        body.slice(photo.source.openEnd, photo.source.closeStart) +
        '</div>'
      : ''
  return (
    body.slice(0, root.source.start) +
    '<section class="ar-closing ar-band">' +
    picture +
    '<div class="ar-container">' +
    quote +
    '</div></section>' +
    body.slice(root.source.end)
  )
}
