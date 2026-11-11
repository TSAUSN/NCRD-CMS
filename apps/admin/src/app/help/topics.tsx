'use client'
import { useState } from 'react'
import { GuardedLink as Link } from '../../components/guarded-link.tsx'
import { Disclosure, SearchField } from '../../components/ui/index.ts'
import styles from './help.module.css'

type Audience = 'all' | 'editor' | 'admin' | 'operator'
const topics: { id: string; title: string; audience: Audience; text: string[]; href?: string; link?: string }[] = [
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
const audienceNames: Record<Audience, string> = {
  all: 'Everyone',
  editor: 'Content editing',
  admin: 'Editing and site administration',
  operator: 'Hosting and maintenance',
}

export function HelpTopics({ role, initialTopic }: { role: string; initialTopic?: string }) {
  const [query, setQuery] = useState('')
  const [audience, setAudience] = useState<Audience>(
    initialTopic ? 'all' : role.toLowerCase().includes('admin') ? 'admin' : 'editor',
  )
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visible = topics.filter(
    topic =>
      (audience === 'all' ||
        topic.audience === 'all' ||
        topic.audience === audience ||
        (audience === 'admin' && topic.audience === 'editor')) &&
      words.every(word =>
        [topic.title, ...topic.text, audienceNames[topic.audience]].join(' ').toLowerCase().includes(word),
      ),
  )
  return (
    <div className={styles.topics}>
      <div className={styles.filters}>
        <SearchField
          id="help-search"
          label="Search CMS help"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search passwords, story tags, DNS…"
        />
        <div className="field">
          <label htmlFor="help-audience">Work area</label>
          <select id="help-audience" value={audience} onChange={event => setAudience(event.target.value as Audience)}>
            {Object.entries(audienceNames).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status">
        {visible.length} help {visible.length === 1 ? 'topic' : 'topics'}
      </p>
      {visible.length === 0 && <p>No matching topics. Try fewer words or choose Everyone.</p>}
      {visible.map(topic => (
        <Disclosure
          key={`${topic.id}-${query}-${audience}`}
          id={topic.id}
          title={topic.title}
          open={topic.id === initialTopic || words.length > 0}
        >
          {topic.text.map(text => (
            <p key={text}>{text}</p>
          ))}
          {topic.href && (
            <p>
              <Link href={topic.href}>{topic.link}</Link>
            </p>
          )}
        </Disclosure>
      ))}
    </div>
  )
}
