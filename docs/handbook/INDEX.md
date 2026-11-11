# Handbook index

Where to find the steps for a task, for editors, site admins and maintainers.

For: Editors, maintainers and site admins. Last checked: 2026-11-05.

Every change an editor makes stays a private draft until it is reviewed and published.
Permissions are enforced by the database, not only by the screens.

## How do I…

| Task | Guide | Where to look |
| --- | --- | --- |
| Walk the Friday review demo | [start-here/demo-route.md](start-here/demo-route.md) | 12 steps, environment routes and open gates |
| Learn how the CMS works and do ten common tasks | [start-here/README.md](start-here/README.md) | Whole guide |
| Ship a code update to the Google review | [upgrades/ship-an-update.md](upgrades/ship-an-update.md) | Tested commands and rollback |
| Understand a word the CMS uses | [start-here/glossary.md](start-here/glossary.md) | The table |
| Find role-based steps inside the CMS | Open **Help** in the sidebar (`/help`) | Choose Guidance for, search a task, or open a common-task guide; permissions stay unchanged |
| Sign in | [start-here/sign-in.md](start-here/sign-in.md) | Whole guide |
| Find my work after signing in | [start-here/content-home.md](start-here/content-home.md) | Whole guide |
| Find the CMS name for something I did in Symphony | [start-here/coming-from-symphony.md](start-here/coming-from-symphony.md) | The table |
| Find a page or start a new one | [editing/pages.md](editing/pages.md) | Whole guide |
| Add a section to a page | [editing/adding-sections.md](editing/adding-sections.md) | Whole guide |
| Change a title or where a link goes | [editing/titles-and-links.md](editing/titles-and-links.md) | Whole guide |
| Edit cards or other repeated content | [editing/cards.md](editing/cards.md) | Whole guide |
| Edit hero slides | [editing/hero-slides.md](editing/hero-slides.md) | Whole guide |
| Copy a section to another page | [editing/copying-sections.md](editing/copying-sections.md) | Whole guide |
| Add, move or remove a menu item | [site-setup/header-menu-footer.md](site-setup/header-menu-footer.md) | "In Menu, Add to menu…" |
| Change the logo or header buttons | [site-setup/header-menu-footer.md](site-setup/header-menu-footer.md) | "In Logo…" and "In Header buttons…" |
| Change colours, fonts and buttons | [site-setup/site-look.md](site-setup/site-look.md), [site-setup/fonts.md](site-setup/fonts.md) | Whole guides |
| Describe or organize an image | [editing/media.md](editing/media.md) | Whole guide |
| Update a number used on several pages | [editing/data-values.md](editing/data-values.md) | Whole guide |
| Publish a page | [publishing/publish-a-page.md](publishing/publish-a-page.md) | Whole guide |
| Schedule a page | [publishing/schedule-a-page.md](publishing/schedule-a-page.md) | Whole guide |
| See what changed before publishing | [publishing/review-changes.md](publishing/review-changes.md) | Whole guide |
| Fix a publishing check | [publishing/checks.md](publishing/checks.md) | Whole guide |
| Restore an older version | [publishing/review-changes.md](publishing/review-changes.md) | "Restore as new draft" |
| Connect a site to GA4 | [site-setup/analytics.md](site-setup/analytics.md) | Measurement ID, tracking and test-address switches |
| Write, tag and publish a story | [editing/stories.md](editing/stories.md), [editing/story-tags.md](editing/story-tags.md) | Whole guides |
| Publish or schedule a story | [editing/story-publishing.md](editing/story-publishing.md) | Whole guide |
| Choose which stories lead the Newsroom | [editing/newsroom-order.md](editing/newsroom-order.md) | Whole guide |
| Show stories on a map or in Split View | [editing/story-world.md](editing/story-world.md), [editing/story-split.md](editing/story-split.md) | Whole guides |
| Spread stories out on a calendar | [editing/coming-up.md](editing/coming-up.md) | Whole guide |
| Set up a new site | [site-setup/create-a-site.md](site-setup/create-a-site.md) | Whole guide |
| Set up Echelon chapters and their pages | [site-setup/echelon-templates.md](site-setup/echelon-templates.md), [site-setup/chapter-destinations.md](site-setup/chapter-destinations.md) | Whole guides |
| Add a person or change their site access | [people/adding-a-person.md](people/adding-a-person.md) | Access creation, sign-in prerequisite and restricted view |
| Decide who can do what | [people/roles.md](people/roles.md) | Role/scope boundaries and common tasks; hosted role acceptance is separate |
| Recover from a problem | [fixing-things/common-problems.md](fixing-things/common-problems.md) | Whole guide |

## For maintainers

| Task | Where |
| --- | --- |
| Run the demo on your own computer | `pnpm install` then `pnpm demo` (see [README](../../README.md)); a clean install from GitHub is in [hosting/local-demo.md](hosting/local-demo.md) |
| Follow a feature from screen to SQL, renderer and tests | [maintainers/where-things-live.md](maintainers/where-things-live.md) |
| Enable staged and production releases or recover a previous revision | [upgrades/automatic-releases.md](upgrades/automatic-releases.md) |
| Understand how the code fits together | [docs/architecture.md](../architecture.md) |
| Read a database command as it exists today | [Current SQL reference](../../packages/schema/current/README.md) |
| Prove a behavior-preserving refactor | [maintainers/refactor-gates.md](maintainers/refactor-gates.md) |
| Run tests | [docs/operations.md](../operations.md). Build the admin and site before browser tests; they refuse a stale build. |
| Format code | `pnpm format`. CI checks it with `pnpm format:check`. |
| Back up and recover | [upgrades/backup-recovery.md](upgrades/backup-recovery.md) |
| Prepare a clean hosted content copy | [hosting/local-staging.md](hosting/local-staging.md#prepare-the-maintainer-review-hosted-copy) |
| Bootstrap an empty organization project (administrator operated) | [hosting/bootstrap.md](hosting/bootstrap.md) |
| Receive the private release and sign-in packet | [hosting/private-release-handoff.md](hosting/private-release-handoff.md) |
| Run Friday deployment checks and rollback | [hosting/friday-go-live.md](hosting/friday-go-live.md) |
| Size the database and review measured speed | [hosting/speed-and-size.md](hosting/speed-and-size.md) |
| Deploy the verified Google review and roll back | [hosting/go-live.md](hosting/go-live.md) |
| Compare future organization sign-in choices | [hosting/sign-in-options.md](hosting/sign-in-options.md) | Super-admin-only Friday decision, effort, identity mapping and switch/rollback |
| Review public access and publishable keys with IT | [hosting/public-access-it.md](hosting/public-access-it.md) | One-page access/keys/policy note |
| Prepare domain connection and routing rollback | [hosting/domains.md](hosting/domains.md) | Controlled test first; no DNS action for this release |
| Plan hosting | [hosting/environments.md](hosting/environments.md) and [deploy/google/README.md](../../deploy/google/README.md) |
| Upgrade a running copy | [upgrades/staging-production.md](upgrades/staging-production.md) |
| See why something was decided | [docs/decisions.md](../decisions.md) and [docs/adr/](../adr/) |
| See what is planned | [docs/roadmap.md](../roadmap.md) and [SPEC.md](../../SPEC.md) |

| Review deferred work and observed hosting workarounds | [maintainers/known-next-improvements.md](maintainers/known-next-improvements.md) |

## Rules for changes

- Keep Postgres permissions, immutable versions and the normal draft, review and release commands. Never write around them.
- Update the matching guide in the same commit as a feature change. Each guide has a title, a one-line summary, its audience and the date it was last checked.
- A guide describes what the product does today. Planned work belongs in [docs/roadmap.md](../roadmap.md).
- Nothing in this handbook authorizes cloud changes, deployment or automated drafting. Hosting steps are plans until they are checked against a real, administrator-provided project.
