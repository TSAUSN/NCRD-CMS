'use client'
import type { SitePublicSettings } from '@cms/schema'
import type { SiteSettingsWorkspace } from '../../../../lib/site-settings.ts'
import { Card } from '../../../../components/ui/card.tsx'
import { TextLink } from '../../../../components/ui/text-link.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { SettingsEditor, useSettingsDraft } from './settings-editor.tsx'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
type GeneralInput = { name: string; general: NonNullable<SitePublicSettings['general']> }
function input(payload: unknown): GeneralInput {
  const settings = payload as SitePublicSettings
  return {
    name: settings.name,
    general: settings.general ?? { description: '', country: '', language: 'en', email: '', phone: '', address: '' },
  }
}
export function GeneralSettingsWorkspace({
  siteId,
  siteName,
  chapters,
  archived,
  initial,
}: {
  siteId: string
  siteName: string
  chapters: boolean
  archived: boolean
  initial: SiteSettingsWorkspace
}) {
  const draft = useSettingsDraft(
    siteId,
    archived,
    initial,
    'general',
    'General settings',
    input(initial.settings),
    value => value,
    input,
    'Enter a site name, a valid contact email and a language.',
  )
  const value = draft.value
  const disabled = archived || draft.pending
  function change(key: keyof GeneralInput['general'], next: string) {
    draft.change(current => ({ ...current, general: { ...current.general, [key]: next } }))
  }
  const languages = [
    ['en', 'English'],
    ['es', 'Spanish'],
    ['fr', 'French'],
    ['pt', 'Portuguese'],
    ['de', 'German'],
    ['ar', 'Arabic'],
    ['zh', 'Chinese'],
  ]
  if (!languages.some(([code]) => code === value.general.language)) {
    let name = value.general.language
    try {
      name = new Intl.DisplayNames(['en'], { type: 'language' }).of(name) ?? name
    } catch {}
    languages.push([value.general.language, name])
  }
  return (
    <SettingsEditor siteId={siteId} siteName={siteName} archived={archived} current="General" path="" draft={draft}>
      <div className={shared.denseStack}>
        <Card title="General" density="editor">
          <Field id="site-general-name" label="Site name">
            <input
              value={value.name}
              maxLength={120}
              disabled={disabled}
              onChange={event => draft.change(current => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field
            id="site-general-description"
            label="Description for search"
            counter={value.general.description.length + ' of 155'}
          >
            <input
              value={value.general.description}
              maxLength={155}
              disabled={disabled}
              placeholder="[One or two plain sentences about this site]"
              onChange={event => change('description', event.target.value)}
            />
          </Field>
          <div className={workspaceFormsStyles.formRow}>
            <Field id="site-general-country" label="Country">
              <input
                value={value.general.country}
                maxLength={100}
                disabled={disabled}
                onChange={event => change('country', event.target.value)}
              />
            </Field>
            <Field id="site-general-language" label="Language">
              <select
                value={value.general.language}
                disabled={disabled}
                onChange={event => change('language', event.target.value)}
              >
                {languages.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            id="site-general-email"
            label="Contact email"
            help="Saved with this site's details. This address does not receive messages from a contact form."
            helpAfter
          >
            <input
              type="email"
              value={value.general.email}
              maxLength={254}
              disabled={disabled}
              placeholder="[email address]"
              onChange={event => change('email', event.target.value)}
            />
          </Field>
          <Field id="site-general-phone" label="Contact phone">
            <input
              type="tel"
              value={value.general.phone}
              maxLength={80}
              disabled={disabled}
              placeholder="[phone number]"
              onChange={event => change('phone', event.target.value)}
            />
          </Field>
          <Field id="site-general-address" label="Mailing address">
            <input
              value={value.general.address}
              maxLength={1000}
              disabled={disabled}
              placeholder="[address]"
              onChange={event => change('address', event.target.value)}
            />
          </Field>
          <p className="hint">
            These contact details do not replace text on public pages. To change what visitors see, edit the page or
            Footer. The logo, menu and Donate button are in Header &amp; menu.
          </p>
          {!draft.valid && (
            <p role="alert">
              Enter a site name and a valid contact email. The description can have up to 155 characters.
            </p>
          )}
        </Card>
        {chapters && (
          <Card title="Contact messages" density="editor">
            <p>Read messages visitors sent through this site’s contact form. Email forwarding is not configured.</p>
            <TextLink href={'/sites/' + siteId + '/settings/contact-messages'}>Read contact messages</TextLink>
          </Card>
        )}
      </div>
    </SettingsEditor>
  )
}
