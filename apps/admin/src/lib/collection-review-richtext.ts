import { sanitizeRichText } from '@cms/renderer'

/**
 * A snapshot is inspection evidence, not a navigation surface. Work only on the
 * canonical sanitizer output: its href strings are already escaped and can be
 * emitted as text without decoding them back into potentially active markup.
 * Formatting inside a link remains intact; destinations stay visible beside it.
 */
export function collectionReviewRichText(input: string): string {
  const destinations: (string | null)[] = []
  return sanitizeRichText(input).replace(/<a\b[^>]*>|<\/a>/g, tag => {
    if (tag === '</a>') {
      const destination = destinations.pop()
      return (
        '</span>' +
        (destination === null || destination === undefined
          ? ''
          : ` <small>(destination: <code>${destination}</code>)</small>`)
      )
    }
    destinations.push(/\bhref="([^"]*)"/.exec(tag)?.[1] ?? null)
    return '<span>'
  })
}
