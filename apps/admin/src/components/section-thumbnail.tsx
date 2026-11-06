// The picture on a section card (SPEC §6.5, D3).
//
// Two rules, and both are about what a library screen costs to open. It is a
// *static* image, never a live iframe, because the acceptance line is "library
// first paint ≤1s with thumbnails and no live iframes at rest" and forty live
// renderers is not a first paint. And the box it sits in is reserved with
// `aspect-ratio` whether or not a thumbnail exists, so the grid does not reflow
// as images arrive — a layout that settles after the fact reads as slower than
// one that was always that shape.
//
// HOW THE PICTURE IS FITTED, AND WHY IT IS NOT `object-fit: cover`
//
// The capture is a whole 1200px-wide page band. Its width is the part that
// carries the information: a hero is centred columns, a call to action is a
// full-bleed strip with something in the middle, a feature row is three things
// side by side — and every one of those is destroyed by trimming the sides.
// `cover` in a card-shaped box does exactly that whenever the band is wider in
// proportion than the card, which is most of the time.
//
// So the image is laid in at the frame's full width, keeping its natural height,
// and the frame clips whatever does not fit vertically. A tall section loses its
// bottom; a short one is centred against the frame's own ground, which reads as
// a band sitting in a page rather than as a render that stopped halfway. The
// capture is a matching 5:2 to keep that second case rare (see
// `THUMBNAIL_VIEWPORT`).
//
// A definition with no thumbnail yet says so in words rather than showing a
// blank rectangle a reader would take for an empty section. Thumbnails are made
// by a background job, so "not yet" is a normal state and not an error.
import type { ReactNode } from 'react'
import type { LibraryEntry } from '../lib/queries.ts'
import { IconImage } from './icons.tsx'

/** Where the media route serves a stored object from. */
export function thumbnailUrl(path: string): string {
  return `/media/${path.replace(/^\/+/, '')}`
}

/**
 * The frame, so the two places that show a section picture cannot disagree
 * about its shape. `element` lets the library overlay put this inside a
 * <button>, where a <div> would be invalid content.
 */
export function SectionThumbnail({
  entry,
  element = 'div',
  eager = false,
}: {
  entry: Pick<LibraryEntry, 'thumbnail_path'> & Partial<Pick<LibraryEntry, 'slug'>>
  element?: 'div' | 'span'
  /**
   * Load immediately rather than when scrolled to.
   *
   * The library overlay asks for this. `loading="lazy"` defers even images that
   * are already in the viewport until layout has settled, which in a dialog
   * that has just opened means a second or two of empty grey frames where the
   * pictures should be — and the pictures are the reason the dialog exists.
   * `fetchpriority="low"` keeps them behind anything the page still needs.
   */
  eager?: boolean
}): ReactNode {
  const Frame = element
  const coreFallback =
    entry.slug && /^core-[a-z0-9-]+$/.test(entry.slug) ? `/cms-samples/sections/${entry.slug}.png` : null
  if (entry.thumbnail_path === null && !coreFallback) {
    return (
      <Frame className="section-thumb-frame">
        <Frame className="section-thumb-none">
          <IconImage size={20} />
          No preview picture yet
        </Frame>
      </Frame>
    )
  }
  return (
    <Frame className="section-thumb-frame">
      <img
        className="section-thumb"
        src={entry.thumbnail_path ? thumbnailUrl(entry.thumbnail_path) : coreFallback!}
        // The card already names the section beside the picture, so a description
        // repeating it would be read out twice by a screen reader for no gain.
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority="low"
        decoding="async"
        width={1200}
        height={480}
      />
    </Frame>
  )
}
