# National core theme

Revision 8 preset, updated 2026-10-28 from the maintainer’s read-only local
`cms-v2-demo-sprint/national-theme.md` measured reference. This replaces the
provisional October25 values; it is not an import of national CSS.

- Brand: #EF3E42. Button labels on that fill use black (5.44:1); #1C1B1F is
  4.44:1 and white is unsuitable for small text. Inline links/kickers use the
  theme's dark text; the red remains available for non-text accents.
- Navy: #002056 with white labels. Ink: #1C1B1F; muted: #5B5B5B; surface: white;
  soft fill: #EFEFEF. Optional rounded-panel presentation uses canvas #D9D9D9.
- Creato Display for headings/body in the local National/Echelon presets,
  approved October28 from the organization's local AO Hub WOFF2 files.
  Seven exact faces are checked by hash and served only on local hosts in
  explicit local-test mode. Assets live outside public/; existing demonstration
  assets and stored themes are unchanged. Open Sans remains the fallback,
  self-hosted from Fontsource5.3.0 under SIL OFL1.1. Material Symbols Outlined400
  is self-hosted from Fontsource5.3.9 under SIL OFL1.1. No runtime CDN.
- Panel/card corners: 1.25rem (20 px); button corners: 0.5rem (8 px), comfortable
  spacing. Native panels have a 64rem maximum content width and responsive
  gutters. Echelon reverses primary/accent for navy dominance. The presentation
  is an explicit bounded theme value; existing stored themes are not rewritten.
- Bootstrap 5.3.8 grid subset, vendored locally with MIT license; custom section layout CSS is scoped by the existing compiler.
- Sample illustrations are original geometric artwork, with no Salvation Army people, logos or licensed font files. Provenance and licensing: packages/seeds/CORE-ASSETS-LICENSE.md.

The preset is packages/seeds/src/core-themes.ts. **Needs administrator input:** confirm the
font licence before public hosting, and supply the official chapters logo/photo
assets. Keep a text wordmark and labelled sample media meanwhile. The Leaders
Symposium logo is not the chapters logo. Do not vendor the unconfirmed national
stylesheet, Trajan Pro or Proxima Nova for these native presets.
The other named presets keep their previous values; imported BT2027 continues
using only its reviewed design files. No live source or font CDN was fetched.
