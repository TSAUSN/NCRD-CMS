// Synthetic source fixtures, authored for isolated migration regression tests.
// These are not a recovered V1 catalogue, production page or parity baseline.
export const cohesiveCopy = {
  html:
    '<section class="source-card"><h2 data-editable="text" data-cms-label="Heading">Community support</h2>' +
    '<div class="source-copy" data-editable="richtext" data-block-id="support-copy" data-cms-label="Support &amp; resources">' +
    '<p>Find <strong>practical support</strong>, <em>near you</em>, and <a href="/resources?topic=food&amp;area=north#guides">local guides</a>.</p>\n' +
    '<p>Speak to our team at <a href="mailto:hello@example.test">hello@example.test</a><br>or <a href="tel:+15555550100">555-555-0100</a>.</p>' +
    '<ul><li>Food and shelter</li><li><strong>Community</strong> connections</li></ul>' +
    '</div></section>',
  css: '.source-card{max-width:42rem;padding:2rem;background:#fff}.source-copy{line-height:1.6}.source-copy p{margin:0 0 1rem}.source-copy a{text-decoration:underline}.source-copy ul{padding-left:1.5rem}',
}

export const boundedCopy = {
  html:
    '<div class="source-copy" data-editable="richtext" data-cms-label="Overview">' +
    '<p>Explore <strong>available help</strong>.</p><p>Read <a href="/guides#start">our guide</a>.</p>' +
    '<aside class="notice" aria-label="Eligibility"><p>Eligibility <em>varies by location</em>.</p><p>Ask us for details.</p></aside>' +
    '<p data-editable="text" data-cms-label="Eligibility note">This is <strong>an independently editable note</strong>.</p>' +
    '<a data-editable="link" data-cms-label="Registration" class="cta" target="_blank" rel="noopener noreferrer" href="https://example.test/register?ref=site&amp;event=community">Register <strong>today</strong></a>' +
    '<img data-editable="image" data-cms-label="Team photo" class="cover" src="/team.png" alt="Community team">' +
    '</div>',
  css: '.source-copy{line-height:1.6}.notice{padding:1rem;border-left:3px solid #a00}.cta{display:inline-block}.cover{max-width:100%}',
}
