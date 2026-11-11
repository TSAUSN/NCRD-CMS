'use client'
import { useState } from 'react'
import { GuardedLink as Link } from '../../components/guarded-link.tsx'
import { Card } from '../../components/ui/card.tsx'
import { Disclosure } from '../../components/ui/disclosure.tsx'
import { SearchField } from '../../components/ui/search-field.tsx'
import { Button } from '../../components/ui/button.tsx'
import { helpTopics } from './content.ts'
import { audienceNames, helpForRole, helpRoles, searchHelp, suggestedHelpRole, type HelpRole } from './roles.ts'
import styles from './help.module.css'

export function HelpTopics({
  role,
  initialTopic,
  isSuperAdmin = false,
}: {
  role: string
  initialTopic?: string
  isSuperAdmin?: boolean
}) {
  const [query, setQuery] = useState('')
  const [audience, setAudience] = useState<HelpRole>(initialTopic ? 'all' : suggestedHelpRole(role))
  const profile = helpRoles[audience]
  const matching = helpTopics.filter(topic => helpForRole(topic, audience) && searchHelp(topic, query))
  const visible = initialTopic
    ? [...matching.filter(topic => topic.id === initialTopic), ...matching.filter(topic => topic.id !== initialTopic)]
    : matching
  const matchingOtherRoles = helpTopics.filter(
    topic => !helpForRole(topic, audience) && searchHelp(topic, query),
  ).length
  return (
    <div className={styles.topics}>
      <section aria-labelledby="help-role-title" className={styles.roleGuide}>
        <h2 id="help-role-title">Start with your role</h2>
        <p>
          Your account shows {role}. Your role and assignments can differ between sites. These guidance choices do not
          change your access.
        </p>
        <div className={styles.filters}>
          <div className="field">
            <label htmlFor="help-audience">Guidance for</label>
            <select id="help-audience" value={audience} onChange={event => setAudience(event.target.value as HelpRole)}>
              {Object.entries(helpRoles).map(([value, profile]) => (
                <option key={value} value={value}>
                  {profile.label}
                </option>
              ))}
            </select>
          </div>
          <SearchField
            id="help-search"
            label="Search CMS help"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Add users, give site access, create a website…"
          />
        </div>
        <Card density="settings">
          <h3>{profile.label}</h3>
          <p>{profile.summary}</p>
          <ul className={styles.shortcuts} aria-label="Common tasks for this role">
            {profile.tasks.map(id => {
              const topic = helpTopics.find(topic => topic.id === id)!
              return (
                <li key={id}>
                  <Link href={'/help?topic=' + id}>{topic.title}</Link>
                </li>
              )
            })}
          </ul>
        </Card>
      </section>
      <p role="status">
        {visible.length} help {visible.length === 1 ? 'topic' : 'topics'}
      </p>
      {query.trim() && matchingOtherRoles > 0 && audience !== 'all' && (
        <p>
          There are {matchingOtherRoles} matching topics for other roles.{' '}
          <Button type="button" variant="tertiary" onClick={() => setAudience('all')}>
            Search everyone’s guidance
          </Button>
        </p>
      )}
      {visible.length === 0 && <p>No matching topics. Try fewer words or choose Everyone.</p>}
      {visible.map(topic => (
        <Disclosure
          key={`${topic.id}-${query}-${audience}`}
          id={topic.id}
          title={topic.title}
          open={topic.id === initialTopic || query.trim().length > 0}
        >
          <p className={styles.audience}>For {audienceNames[topic.audience].toLowerCase()}</p>
          {topic.text.map(text => (
            <p key={text}>{text}</p>
          ))}
          {topic.steps && (
            <ol className={styles.steps}>
              {topic.steps.map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          {topic.href && (!topic.superAdminLink || isSuperAdmin) && (
            <p>
              <Link href={topic.href}>{topic.link}</Link>
            </p>
          )}
          {topic.superAdminLink && !isSuperAdmin && (
            <p>
              Ask a Super admin to carry out these steps. You can inspect your own assignments in{' '}
              <Link href="/people">People &amp; access</Link>.
            </p>
          )}
          <p>
            <Link href={'/help?topic=' + topic.id}>Link to this guide</Link>
          </p>
        </Disclosure>
      ))}
    </div>
  )
}
