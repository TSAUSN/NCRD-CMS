# Roles — draft for review

Each person sees the controls for their work; database permissions remain enforced.

For: Admins, Super admins and reviewers. Last checked: 2026-11-02.

This is the approved RoleViews draft target, not a claim that every screen already
implements it. The newer display names map to existing permission identifiers:
Super admin → super_admin, Admin → site_admin, Site editor → editor, Content creator
→ contributor. Page editor means an assigned-page scope, not a new whole-site
role. Comment-only reviewers remain comment-only. People and role badges now use these display names. Scope notes still distinguish
assigned pages and divisions. No database permission changed.

| Work | Super admin | Admin | Site editor | Content creator | Page editor |
| --- | --- | --- | --- | --- | --- |
| Edit words, photos and links on allowed pages | Yes | Yes | Yes | Yes | Assigned pages |
| Add and tag stories | Yes | Yes | Yes | Yes | No |
| Add and move page sections | Yes | Yes | Yes* | No | No |
| Publish or schedule | Yes | Yes | Yes | No | No |
| Create pages | Yes | Yes | Yes | No | No |
| Header, menu and footer | Yes | Yes | No | No | No |
| Manage tags | Yes | Yes | No | No | No |
| Site look and people | Yes | Yes | No | No | No |
| Section spacing and appearance | Yes | Yes | No | No | No |
| Template, fonts, hosting and code | Yes | No | No | No | No |

*The hard Round 3 content-only rule currently hides section management from
Site editors. [Current role behavior](roles.md) records this exception; the draft
permission matrix still needs review.

Current sidebar work hides native Header & menu, Footer, Site look, Settings and
management tools from content roles. Cross-site administration grants no local
controls. Original-design workflows stay unchanged. Existing global People
access is still guarded for Super admins; the Admin people-management draft
needs its own site-scoped implementation. Do not broaden database access merely
to match this table. Existing invitations, chapter scopes and reviews remain.

Editor task Home and the native short menu have local role checks. Site-level
Content creators now create private Stories and use the existing Reviews for a
paired Story/article review. Page-editor approval retains the existing page
workflow. Still required: the complete writing-panel matrix across every screen,
site-scoped Admin people management, and the final
fresh-account acceptance walk. Existing accessible Lists, Reviews and Activity
remain where needed until those task screens are verified. Native site settings
and content roles never share site-wide editing controls.
