import { describe, expect, it } from 'vitest'
import { eventFallbacks } from './event-fallbacks.ts'

describe('event source empty-state preservation', () => {
  it('copies literal source fallback prose only for a proven empty default and empty source target', () => {
    const result = eventFallbacks(
      '<div id="speaker-grid"></div><div id="timeline-track">Saved event</div>',
      'export const speakers = []\nexport const timeline = []',
      'grid.innerHTML = \'<p class="event-empty-state" role="status">Speakers coming soon.</p>\'; track.innerHTML = \'<p class="event-empty-state">Milestones coming soon.</p>\'',
    )
    expect(result.html).toContain('Speakers coming soon.')
    expect(result.html).toContain('Saved event')
    expect(result.html).not.toContain('Milestones coming soon.')
    expect(result.issues).toContain('fresh-event-collection-export-required')
  })
  it('leaves each list as V1’s script does when it is empty: is-empty, faded arrows, no day tabs (FID-05)', () => {
    const source =
      '<div class="timeline-carousel"><button class="carousel-control" type="button" data-timeline-step="-1">‹</button>' +
      '<div id="timeline-track" class="timeline-track"></div><button class="carousel-control" type="button" data-timeline-step="1" disabled="">›</button></div>' +
      '<div id="agenda-panel" class="agenda-panel"><div class="agenda-tabs" role="tablist"><button type="button" data-agenda-day="day-1">Day 1</button></div>' +
      '<div id="agenda-content" class="agenda-content" aria-live="polite"></div></div><div id="speaker-grid" class="speaker-grid"></div>'
    const result = eventFallbacks(
      source,
      'export const speakers = []\nexport const timeline = []\nexport const agenda = []',
      'grid.innerHTML = \'<p class="event-empty-state" role="status">Speakers soon.</p>\'\n' +
        'track.innerHTML = \'<p class="event-empty-state" role="status">Milestones soon.</p>\'\n' +
        'content.innerHTML = \'<p class="event-empty-state">Agenda soon.</p>\'',
    )
    expect(result.html).toContain(
      '<div id="speaker-grid" class="speaker-grid is-empty"><p class="event-empty-state" role="status">Speakers soon.</p></div>',
    )
    expect(result.html).toContain(
      '<div id="timeline-track" class="timeline-track is-empty"><p class="event-empty-state" role="status">Milestones soon.</p></div>',
    )
    expect(result.html.match(/<button class="carousel-control"[^>]*>/g)).toEqual([
      '<button class="carousel-control" type="button" data-timeline-step="-1" disabled="">',
      '<button class="carousel-control" type="button" data-timeline-step="1" disabled="">',
    ])
    expect(result.html).toContain('<div class="agenda-tabs" role="tablist" hidden="">')
    expect(result.html).toContain(
      '<div id="agenda-content" aria-live="polite" class="agenda-content is-empty" role="status"><p class="event-empty-state">Agenda soon.</p></div>',
    )
    expect(result.html).not.toMatch(/data-timeline-step="[^"]*"[^>]*hidden/)
  })
  it('never evaluates source code or treats an authored collection as empty', () => {
    const html = '<div id="speaker-grid"></div>'
    expect(
      eventFallbacks(html, 'export const speakers = loadSpeakers()', 'throw new Error("do not execute")').html,
    ).toBe(html)
    expect(
      eventFallbacks(
        html,
        'export const speakers = [{name:"Saved speaker"}]',
        'grid.innerHTML = \'<p class="event-empty-state">Empty</p>\'',
      ).html,
    ).toBe(html)
  })
})
