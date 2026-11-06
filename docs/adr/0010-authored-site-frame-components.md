# ADR 0010 — authored header and footer components

**Status:** accepted by the user on 2026-09-23; implemented (migration 0084, renderer, admin, importer `migration frame`)
**Date:** 2026-09-23
**Evidence:** HNI source-fidelity baseline F1–F7, preserved in Git history.

## Problem

Every source-fidelity defect in the HNI baseline comes from one place. A site's header and footer can only be one of four header presets and three footer presets (`HeaderConfigV1`, `FooterConfigV1`), and the importer moves whatever doesn't fit into page sections. Editors must understand that a footer edit is site-wide. The Salvation Army footer is consistent, with an optional partner or presenter identity on relevant sites.

## Decision

A header or footer may be an **authored component**: an ordinary versioned section definition marked for that placement, pinned by the site's header or footer version, with its own field values.

1. **Placement.** `section_defs.placement` is `page` (the default), `header` or `footer`. Only a super admin changes it (`app.set_section_def_placement`), and only while no page or global-element version uses the definition. Page versions refuse definitions whose placement is not `page` (trigger). The page library lists only `page` definitions.
2. **Content version 2.** A header or footer version may be
   `{schemaVersion: 2, enabled, sticky (header only), component: {section_def_id, section_def_version, values}}`.
   Version 1 presets stay valid and render as before. Saving checks shape only. Publishing checks readiness: the definition exists at that version, has the matching placement, belongs to the site or is global, carries no trusted code, and passes the same AST and CSS checks as a page section.
3. **One pin, deliberate upgrades.** Pages don't share a component's content. The site's header version owns one value set, and that is what makes it site-wide. A new definition version reaches the site only when someone saves a header draft pinned to it and publishes it. This is the page rule applied to the frame.
4. **Navigation stays governed.** A new slot kind, `navigation`, has no stored value. The renderer fills it with the site's published (or, in private preview, saved) navigation tree, and marks the current page with `aria-current="page"`. It may only sit in element text and may appear more than once (desktop row and phone menu). In a page section it renders nothing.
5. **No scripts.** Public pages stay scriptless. Phone menus and contact pop-outs use `<details>`/`<summary>`, which templates already permit (ADR 0009).
6. **Rendering.** The shell projection (`app.rebuild_site_shell`) and the private draft preview both attach the pinned compiled definition as `header_component` / `footer_component`, in the same shape the page manifest uses. `renderPage` renders it inside `<header>`/`<footer>` carrying `cms-section--<slug>`, so the definition's scoped CSS applies. If a v2 config arrives without a matching definition, the renderer falls back to the baseline shell rather than rendering a different frame silently.
7. **Scope clarity.** Editing happens only in *Site appearance → Header & footer*, with a notice naming how many pages it affects. In the page canvas the frame is marked as site-wide.

## Consequences

- Sites migrated from V1 keep their real frame, including the partner identity in the header and a contact pop-out, with no page sections standing in for them.
- The shared-foundation rule that only a super admin may hide the Salvation Army footer text applies to presets. An authored footer exists only because a super admin set a definition's placement, and that is the control point for authored frames.
- Updated October 2, 2026: migration 0085 includes every retained authored-frame pin, its source definition and placement in content archives, including historical/retired definitions and frame-only media/document assets. Import remaps IDs, recompiles definitions and preserves versions without publishing. Real PostgreSQL round-trip and adversarial import tests cover this contract; the interactive browser journey still needs its local rerun. Missing, foreign or misplaced pins fail explicitly.
- Updated October 2, 2026: the super-admin Frame components workspace can retire and restore definitions through an audited command (0086). Retired definitions disappear from new choices but remain available through existing immutable pins. Their CSS scope stays reserved so reusing a slug cannot restyle an older frame.
- Updated October 2, 2026: the HTML creator exposes a Site menu field kind and actual header/footer placement previews. Navigation stays governed by the site menu, with no separately stored field value; page placements reject navigation fields.
- Rejected: more preset options (they approximate every future site and grow without bound), and approved raw frame HTML (no fields, and a menu not managed through Navigation).
