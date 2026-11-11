# Roles and site assignments

For all CMS users. Last checked: November 11, 2026 against the current role,
navigation and account-management code. This guide explains supported work;
full hosted acceptance with each real role remains a release check.

## Start with your role

Open **Help** in the CMS sidebar. **Guidance for** starts from your account's
role and offers the common tasks for that role. Search includes guide titles,
steps and common names such as “add users.” Choose **Everyone** to find another
role's instructions. Guidance choices never change permissions. A person's role
can differ between websites; **People & access** shows actual assignments.

| Role or scope | Usual work | Ask someone else for |
| --- | --- | --- |
| Super admin | People, whole-site assignments, new websites and work across sites | Google/Supabase infrastructure changes unless separately authorized |
| Admin | Assigned site's shared building blocks, appearance, settings and publication | Global account management, creating a website, domains/infrastructure |
| Site editor | Content and publication within assigned sites/pages | Native section/layout management, site-wide appearance and People management |
| Content creator | Drafts and submission for approval | Publication and account/site administration |
| Chapter contributor | Assigned chapter content; submit for approval | Shared national parts, other chapters and publication |
| Division team member | Assigned division's chapters and existing approval workflow | Other divisions and global account management |
| Comment-only reviewer | Existing comment-only review access | Content changes and publication |

Display names map to the existing permission identifiers: Super admin to
`super_admin`, Admin to `site_admin`, Site editor to `editor`, Content creator
to `contributor`. Assigned pages and divisions describe scope, not a new
whole-site role. Native content editors use the offered field controls; the
older RoleViews proposal in [roles-draft.md](roles-draft.md) is not an authority
to expose additional controls. Imported-site interfaces retain their existing
controls. Database commands and publication checks remain authoritative.

## How the CMS fits together

1. A **person** signs in through the configured provider and receives explicit
   CMS site/page/division assignments.
2. A **site** contains its own pages, media, stories/lists, menu, appearance and
   settings. One CMS can manage several websites.
3. **Save draft** stores private content. Preview can show saved changes that
   visitors cannot see yet. A contributor submits a review request.
4. An authorized publisher reviews the selected changes and shared dependencies
   in **Publish**, then confirms. Visitors see published projections through a
   working website address. Code deployment does not publish content drafts.

Google Cloud and Supabase project membership are infrastructure access, separate
from a CMS role. Microsoft sign-in likewise proves identity without granting a
site assignment. Neither selecting a Help role nor knowing a site's address
changes the account's permissions.

## Common tasks by role

- **Super admin:** [add a person or change their site access](adding-a-person.md),
  [create a website](../site-setup/create-a-site.md), review first publication.
- **Admin:** [shared site look](../site-setup/site-look.md),
  [header/menu/footer](../site-setup/header-menu-footer.md),
  [tags](../editing/story-tags.md), [publishing](../publishing/review-changes.md).
- **Site editor / Content creator:** [find and edit a page](../editing/pages.md),
  [stories](../editing/stories.md), [publish or submit](../publishing/publish-a-page.md).
- **Chapter/division team:** [chapter setup and destinations](../site-setup/chapter-destinations.md).
- **Hosting operator:** [domain checks](../hosting/domains.md),
  [deployment](../upgrades/ship-an-update.md), [backup/recovery](../upgrades/backup-recovery.md).

## Narrow access and missing access

Whole-site membership covers every page. Chapter/division assignments remain
separate and survive saving whole-site account fields. An assigned-page editor
can load photos referenced by the page and its history; this does not open the
site-wide Media library or unrelated photos. Removing the assignment removes
that photo access. Deactivation stops all CMS access on the next request while
keeping content and history. An existing Super admin stays global until the
responsible platform administrator changes that role.

If a site is missing, check the signed-in email and **People & access → Your
access**. Ask a Super admin to inspect the exact assignment and account status.
For paused chapter access, also check update mode and archived page/site state.
Do not create a duplicate account or grant every website to fix one missing scope.
