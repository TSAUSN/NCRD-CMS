export type Audience = 'all' | 'editor' | 'admin' | 'operator' | 'super' | 'scoped'
export type HelpTopic = {
  id: string
  title: string
  audience: Audience
  text: string[]
  steps?: string[]
  keywords?: string
  href?: string
  link?: string
  superAdminLink?: boolean
}
export const helpTopics: HelpTopic[] = [
  {
    id: 'cms-map',
    title: 'How people, websites and publishing fit together',
    audience: 'all',
    keywords: 'architecture organization structure users permissions website overview',
    text: [
      'One CMS holds several websites. Each site has its own pages, stories, media, menu, appearance and settings. Your assignments determine which sites or pages you can work on.',
      'Signing in proves who you are. CMS access determines what you can do. A CMS Super admin manages people and sites; Google Cloud and Supabase project access are separate infrastructure permissions.',
    ],
    steps: [
      'A Super admin creates a site and assigns people the appropriate access.',
      'The team edits pages and site-wide items. Save draft stores changes privately; previews can show those saved changes.',
      'A contributor submits work for review. An authorized publisher reviews the selected pages and shared dependencies in Publish, then confirms the release.',
      'Visitors see the published version through a working site address. Creating a site, saving a draft, deploying code and connecting DNS are separate actions.',
    ],
  },
  {
    id: 'roles',
    title: 'Choose the right role and access scope',
    audience: 'all',
    keywords: 'user roles permissions rights administrator editor contributor chapter division reviewer',
    text: [
      'Super admin: manages people, creates websites and works across all sites. A whole-site assignment does not limit an existing Super admin.',
      'Admin: manages an assigned site, its shared building blocks, appearance and settings. Global People management and creating a website still require a Super admin.',
      'Site editor: edits and publishes content within the assigned scope. Native content editing does not include site-wide appearance, shared layout or people management.',
      'Content creator: prepares drafts and submits them for approval. This role cannot publish.',
      'Chapter contributors work on their assigned chapter pages and submit changes. Division team members work on their assigned division’s chapters and approval workflow. These are scoped assignments, not permission to every page on the website.',
      'Comment-only reviewers keep comment-only access. Your role can differ between sites. Open People & access to inspect your actual sites and scopes; selecting a Help role changes guidance only.',
    ],
    href: '/people',
    link: 'Open People & access',
  },
  {
    id: 'add-person',
    title: 'Add a person or invite a new user',
    audience: 'super',
    keywords: 'add users adding people new account invitation invite editor onboarding',
    text: [
      'For Super admins. Before adding a new editor, confirm the sign-in service can deliver and verify that person’s email. Creating CMS access does not create a password or prove mail delivery works.',
    ],
    steps: [
      'Open People & access. Search the exact email first. If the person already exists, edit their access instead of creating another account.',
      'Choose Add person when invitation emails are off, or Invite someone when invitation delivery is enabled.',
      'Enter Name and the exact Email address they will use to sign in.',
      'Under Whole-site access, choose Content creator — drafts and review, Site editor — edit and publish, or Admin — manage this site for each intended website. Leave unrelated websites at No whole-site access. New people need at least one site assignment.',
      'Choose Add person, or Create account & send invitation. If asked to confirm sign-in, use the offered new-tab link, sign in again and return to retry the retained form.',
      'Read the receipt. Add person sends no invitation; the invitation flow queues a message and delivery may still fail. Share the CMS sign-in address through your approved channel.',
      'The person completes their own verified first sign-in, then opens Password to set their own password. An existing password user can sign in normally. Confirm the intended sites appear and an unassigned site is refused, using their own browser profile.',
    ],
    href: '/people',
    link: 'Open People & access',
    superAdminLink: true,
  },
  {
    id: 'site-access',
    title: 'Give an existing person access to a site',
    audience: 'super',
    keywords: 'add users grant permissions assign website membership change role remove revoke access',
    text: [
      'For Super admins. Changes to account access apply on the next request; they do not wait for content publication.',
    ],
    steps: [
      'Open People & access. Use Find a person or Showing people for, then select the person’s name to open Edit account access. Check the email and current Can edit summary.',
      'Open Whole-site access. Set the intended site to Content creator, Site editor or Admin. Use No whole-site access to remove that whole-site assignment. Keep unrelated site choices unchanged.',
      'For someone assigned only a chapter or division, use the separate chapter/division controls described in Chapter and division access. Whole-site access covers every page, so do not use it for a single chapter volunteer.',
      'Choose Save account access, complete the offered sign-in confirmation if needed, then check the saved row and Activity. Save draft and leave only keeps private choices in this browser; it does not apply permissions.',
      'Have the person reload and check their own assigned work. If the account is a Super admin, changing site dropdowns does not remove its global access. Global-role changes require the responsible platform administrator.',
    ],
    href: '/people',
    link: 'Open People & access',
    superAdminLink: true,
  },
  {
    id: 'remove-access',
    title: 'Remove site access or deactivate an account',
    audience: 'super',
    keywords: 'disable deactivate revoke remove user offboarding reactivate',
    text: [
      'To remove one whole-site assignment, open the person in People & access, choose No whole-site access for that site and Save account access. Separate chapter/division assignments remain and must be reviewed in their own controls.',
      'To stop all CMS access, choose Account status → Deactivated — no CMS access, Save account access and confirm Deactivate account. Their pages, drafts and history remain. The current account cannot deactivate itself in this form.',
      'To reactivate, choose Active and save. Review the retained assignments first because access resumes through those assignments. Account changes apply on the next request.',
    ],
    href: '/people',
    link: 'Open People & access',
    superAdminLink: true,
  },
  {
    id: 'new-site',
    title: 'Add a new website',
    audience: 'super',
    keywords: 'create sites adding website new site setup resource event wizard',
    text: [
      'For Super admins. Create a site prepares private draft content. Hosting readiness, publishing and custom-domain setup are separate checks.',
    ],
    steps: [
      'From Home or All sites, choose New site / Create a site. To use a supported content archive instead, choose Import an existing site and follow its separate review.',
      'Name: enter Site name, Short name (or Short address), and One line about the site. Choose Resource site or Event site as the starting point. The short name is not a custom DNS hostname.',
      'Look: choose the appearance. Pages: review the planned pages, titles and addresses. Header & footer: check the shared site name and links.',
      'Review: inspect the complete setup, then choose Create site once. If asked, confirm sign-in in the offered new tab and return to the retained setup. If creation is uncertain, check All sites before starting a different request.',
      'Open the new site’s pages and replace example text/photos with approved content. Assign its team through People & access. Before Create site, a saved setup exists only in this browser and does not grant access or reserve a domain.',
      'Review the first complete site publication and its checks in Publish. Confirm only the intended content and shared settings, publish, then inspect the working public test address.',
      'If the test address says Needs attention or Domains has no DNS records, ask the hosting administrator to resolve the provisioning error. Do not promise the site is reachable just because its private creation succeeded. Connect a custom domain only after the hosting path works.',
    ],
    href: '/sites/new',
    link: 'Open Create a site',
    superAdminLink: true,
  },
  {
    id: 'scoped-access',
    title: 'Work with chapter and division assignments',
    audience: 'scoped',
    keywords: 'chapter division page editor volunteer assigned pages permissions team',
    text: [
      'A chapter contributor edits assigned chapter content and submits changes for approval. Shared national sections, menu and site look stay protected. A division team member works on their division’s chapters and approvals; other divisions remain outside that assignment.',
      'For administrators: use Chapters → select the chapter → Set up for its destination, assigned division and editor setup. A chapter using an external/division-page destination has no local chapter page to invite an editor to. Use Settings → Publishing and approval for new-chapter defaults and division teams; existing chapters keep their own setup.',
      'Chapter invitation receipts can refer to a local outbox; check the receipt and approved delivery setup before promising a real email. In People & access, the account panel lists existing chapter/division assignments and links to Manage chapter access or Manage division team. Saving whole-site account fields keeps those assignments. Deactivating the account pauses all its access.',
      'For your own work, start from Home or Chapters, open the assigned page and edit its offered fields. Save draft, preview and submit for review. Ask the site administrator about a paused or missing chapter assignment rather than requesting every page on the site.',
    ],
    href: '/people',
    link: 'Check your access',
  },
  {
    id: 'missing-access',
    title: 'I signed in but cannot see my website',
    audience: 'all',
    keywords: 'no site access missing site permission denied wrong email login account',
    text: [
      'Check the email shown in the sidebar and open People & access → Your access. Signing in with a different email does not transfer another account’s assignments.',
      'Ask a Super admin to check Account status and the exact whole-site, chapter or division assignment. A Super admin manages global People; an Admin cannot create global accounts from Your access.',
      'After access changes, reload your work. For a paused chapter assignment, the administrator should also check the chapter update mode and whether its page or site is archived. Do not create a second user simply because one assignment is missing.',
    ],
    href: '/people',
    link: 'Check your access',
  },
  {
    id: 'content-work',
    title: 'Edit content and send it through review',
    audience: 'editor',
    keywords: 'content creator contributor site editor edit text photos image page review approval',
    text: [
      'Start at Home, choose the assigned website and open Pages or an assigned task. Select the page and edit the labelled text, photo and link fields. Use an image description for an informative photo and check its crop in Phone preview.',
      'Save draft and check the saved state. Preview the saved work. A Content creator chooses Submit for review; an authorized approver finds the request in Reviews and can publish or ask for changes. A Site editor can publish within the assigned scope.',
      'Review the exact selected changes, including shared lists or Data values. A page draft and the site-wide header/menu/footer can have separate publication changes. After publication, check the real public address. If a check blocks publication, keep the draft and follow its explanation.',
    ],
  },

  {
    id: 'sign-in',
    title: 'Sign in and set your password',
    audience: 'all',
    text: [
      'Open Password in the sidebar while signed in. Type the new password twice and choose Save password. It changes only your own account. Use at least 12 characters.',
      'On the sign-in screen, enter your email and password, then choose Sign in. An email link remains available. Request it and open it in the same browser, using the same CMS hostname.',
      'An incomplete or expired email link cannot be repaired by refreshing it. Use your password or request a fresh link. Your mail security service may open a link before you do; ask the administrator about mail delivery if this keeps happening.',
    ],
    href: '/account/password',
    link: 'Open Password',
  },
  {
    id: 'publish',
    title: 'Save draft, preview and publish',
    audience: 'editor',
    text: [
      'Save draft keeps your changes private. A preview can show saved changes that public visitors cannot see yet.',
      'Use Publish to review the exact pages, lists, Site look and related changes going live. Confirm the intended changes, then check the public address. If your account cannot publish, send the work for approval.',
      'A code deployment and a content publication are separate operations. Pushing application code does not publish your saved page drafts.',
    ],
  },
  {
    id: 'saved-numbers',
    title: '“Publish the saved numbers with this page”',
    audience: 'editor',
    text: [
      'This page uses shared Data values whose saved changes are not live yet. The warning protects visitors from a page referring to numbers that have not been published.',
      'Ask an administrator to review the saved Data values and publish them with the intended page changes through Publish. If you do not have that permission, keep your page draft and request administrator review.',
      'Review the numbers, source and as-of date before publishing. Do not remove the page’s number bindings or replace them with typed text just to clear the warning.',
    ],
  },
  {
    id: 'stories',
    title: 'Tag stories, sectors and regions',
    audience: 'editor',
    text: [
      'Each site has its own main and secondary tags. SAWSO uses sectors and regions. Open Stories, review a story’s suggested tags, correct them, then mark the story reviewed.',
      'Administrators use Manage tags to edit labels and comma-separated keywords. Keywords drive suggestions; a tag with no keywords can still be assigned manually.',
      'Re-suggest tags for unreviewed stories applies the current keyword rules to unreviewed stories only. Review the result before publishing. Reviewed stories keep their editorial choices.',
      'A zero count means no current story is assigned that tag. It does not mean the tag or page is broken. Check relevant stories, their tags and the page’s story filter.',
      'Tag definitions, story edits and their public display follow the draft and Publish workflow. Saving a tag does not by itself update the public site.',
    ],
  },
  {
    id: 'sources',
    title: 'Check for new stories from a source',
    audience: 'admin',
    text: [
      'Open the site’s Stories source controls and choose Check for new stories when you intend to refresh. Opening the screen alone does not refresh the source.',
      'Review new or missing items and tag suggestions before publishing. Confirm that a real newly added or removed source story is reflected correctly; an unchanged feed is not proof of that behavior.',
    ],
  },
  {
    id: 'fonts',
    title: 'Trajan appears in preview but not on the public site',
    audience: 'admin',
    text: [
      'Open Site look → Fonts. Use the approved Adobe kit and Check kit for the actual address. Ask the Adobe account owner to allow a new hostname, then check again.',
      'Save draft stores font choices privately. Review and publish the intended Site look changes, then inspect the public address. Preview and public pages may be showing different saved versions.',
      'Check the actual heading font at its selected weight. Do not edit every page just to force a font refresh. Each new custom hostname needs its own Adobe allowance and browser check.',
    ],
  },
  {
    id: 'domains',
    title: 'Connect a test domain and get DNS instructions',
    audience: 'operator',
    text: [
      'In the site’s Domains screen, reserve the intended test hostname once. Wait for the hosting service to return the exact DNS records. If no records are shown, hosting setup is still incomplete; refreshing does not fix a failed background task.',
      'The Google project administrator should inspect Background work for domain.sync or site.hosting_requested errors. A Firebase Hosting 403 requires checking the runtime service account, project configuration and permissions before retrying the failed task.',
      'Give the DNS administrator only the records displayed for this hostname, including the CMS verification TXT. Keep unrelated mail and verification records. Do not guess an IP, change nameservers or copy another project’s records.',
      'After the DNS administrator applies the approved records, use Verify now. DNS verification, certificate issuance and Live are separate stages. Verify HTTPS, nested pages, images, fonts and redirects before calling the domain ready.',
    ],
  },
  {
    id: 'analytics',
    title: 'Google Analytics for each site',
    audience: 'admin',
    text: [
      'Each site needs its own approved GA4 Measurement ID. Create the property and web data stream in Google Analytics, then copy the G-… ID. Reports inside the CMS need a separate reporting connection; view collected traffic in Google Analytics for now.',
      'Open the site’s Settings → Analytics. Enter its GA4 Measurement ID, choose whether to enable tracking and whether to include test addresses, then save and publish the reviewed settings. Previews and CMS screens are excluded. Do not paste tracking scripts into ordinary page fields.',
    ],
  },
  {
    id: 'microsoft',
    title: 'Prepare Microsoft organization sign-in',
    audience: 'operator',
    text: [
      'Microsoft sign-in appears only after an administrator configures and enables it. IT must provide the approved single-tenant Entra app registration, tenant ID, client ID and securely managed client secret.',
      'IT configures the Supabase Azure provider with the exact callback URL from the deployment handoff. Then the project administrator enables Microsoft sign-in for the CMS and tests an existing authorized account.',
      'Microsoft authentication does not grant CMS permissions. Preserve each person’s existing CMS account and role, and keep password access available during the rollout.',
    ],
  },
  {
    id: 'deployment',
    title: 'Publish a code change and verify the build',
    audience: 'operator',
    text: [
      'Check the change locally, commit the reviewed files to main and push. For the organization’s automatic Google deployment, the commit message must not contain [skip ci].',
      'Watch Google Cloud Build to completion. A GitHub Actions allowance failure is separate from the Google build. Ask the project administrator for the build logs if your Google account cannot read them.',
      'Compare the deployed /health version with the full commit SHA. Confirm the Admin and public Site are healthy, then test the changed user flow. A successful push alone does not prove the change is live.',
      'A staging hostname or Git branch is not database isolation. Use a separate database, media and workers for staging before testing destructive or schema-changing work.',
    ],
  },
]
