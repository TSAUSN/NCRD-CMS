import { pgEnum } from 'drizzle-orm/pg-core'

// Mirrors migrations/0001_core.sql. `check:drift` fails if the database and
// these declarations stop agreeing.
export const userStatus = pgEnum('user_status', ['active', 'disabled'])
export const globalRoleName = pgEnum('global_role_name', ['super_admin'])
export const siteRoleName = pgEnum('site_role_name', ['site_admin', 'editor', 'contributor'])
export const siteKind = pgEnum('site_kind', ['resource', 'event', 'conference', 'campaign', 'general'])
export const siteStatus = pgEnum('site_status', ['onboarding', 'in_progress', 'live', 'archived'])
export const layoutMode = pgEnum('layout_mode', ['sections', 'freeform'])
export const pageStatus = pgEnum('page_status', ['draft', 'published', 'archived'])
export const versionKind = pgEnum('version_kind', ['autosave', 'checkpoint', 'submission', 'publish', 'restore'])
export const sectionScope = pgEnum('section_scope', ['global', 'site'])
export const sectionStatus = pgEnum('section_status', ['active', 'hidden', 'retired'])
export const collectionSource = pgEnum('collection_source', ['builtin', 'admin'])
export const globalElementKind = pgEnum('global_element_kind', ['header', 'footer'])
export const mediaStatus = pgEnum('media_status', ['processing', 'ready', 'failed', 'deleted'])
export const domainKind = pgEnum('domain_kind', ['primary', 'redirect', 'staging'])
export const domainStatus = pgEnum('domain_status', [
  'pending_dns',
  'verifying',
  'issuing_cert',
  'live',
  'error',
  'removing',
])
export const reviewableType = pgEnum('reviewable_type', [
  'page',
  'collection_entry',
  'global_element',
  'site_settings',
  'theme',
  'navigation',
  'release',
])
export const submissionStatus = pgEnum('submission_status', ['open', 'approved', 'rejected', 'superseded'])
export const scheduledActionKind = pgEnum('scheduled_action_kind', ['publish', 'unpublish'])
export const scheduledStatus = pgEnum('scheduled_status', ['pending', 'running', 'succeeded', 'failed', 'cancelled'])
export const actorType = pgEnum('actor_type', ['user', 'system', 'scheduler', 'migration'])
export const outboxStatus = pgEnum('outbox_status', ['pending', 'running', 'delivered', 'dead'])
