import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { collectionSource, mediaStatus, reviewableType } from './enums.ts'
import { appUsers } from './identity.ts'
import { sites } from './sites.ts'

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    // The stable key section slots bind to; renaming must not break bindings.
    readerKey: text('reader_key').notNull(),
    source: collectionSource('source').notNull().default('admin'),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    entryRevision: bigint('entry_revision', { mode: 'number' }).notNull().default(0),
    publishedEntryRevision: bigint('published_entry_revision', { mode: 'number' }).notNull().default(0),
    draftSchemaVersionId: uuid('draft_schema_version_id'),
    publishedSchemaVersionId: uuid('published_schema_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    unique('collections_site_id_slug_key').on(t.siteId, t.slug),
    unique('collections_site_id_reader_key_key').on(t.siteId, t.readerKey),
  ],
)

export const collectionSchemaVersions = pgTable('collection_schema_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  fields: jsonb('fields').notNull(),
  sort: jsonb('sort').notNull(),
  authorId: uuid('author_id').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const collectionEntries = pgTable(
  'collection_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    stableKey: text('stable_key').notNull(),
    sortIndex: integer('sort_index').notNull().default(0),
    publishedSortIndex: integer('published_sort_index'),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    draftVersionId: uuid('draft_version_id'),
    publishedVersionId: uuid('published_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    publishedArchivedAt: timestamp('published_archived_at', { withTimezone: true }),
  },
  t => [unique('collection_entries_collection_id_stable_key_key').on(t.collectionId, t.stableKey)],
)

export const collectionEntryVersions = pgTable('collection_entry_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  entryId: uuid('entry_id').notNull(),
  schemaVersionId: uuid('schema_version_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  values: jsonb('values').notNull(),
  authorId: uuid('author_id').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').references(() => sites.id), // NULL = shared pool
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  objectKey: text('object_key').notNull().unique(),
  contentHash: text('content_hash').notNull(),
  originalName: text('original_name').notNull().default(''),
  // Either described or explicitly decorative before it can become `ready` —
  // the WCAG rule is a database check, not a form validation (0001_core.sql).
  altText: text('alt_text').notNull().default(''),
  decorative: boolean('decorative').notNull().default(false),
  focal: jsonb('focal'),
  folder: text('folder').notNull().default(''),
  attribution: text('attribution').notNull().default(''),
  source: text('source').notNull().default(''),
  tags: text('tags').array().notNull().default([]),
  width: integer('width'),
  height: integer('height'),
  bytes: bigint('bytes', { mode: 'number' }),
  mimeType: text('mime_type').notNull(),
  status: mediaStatus('status').notNull().default('processing'),
  uploadedBy: uuid('uploaded_by').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
})

export const mediaVariants = pgTable(
  'media_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id),
    kind: text('kind').notNull(),
    objectKey: text('object_key').notNull().unique(),
    width: integer('width'),
    height: integer('height'),
    bytes: bigint('bytes', { mode: 'number' }),
    mimeType: text('mime_type'),
    contentHash: text('content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [unique('media_variants_media_id_kind_key').on(t.mediaId, t.kind)],
)

export const mediaUsage = pgTable(
  'media_usage',
  {
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    itemType: reviewableType('item_type').notNull(),
    itemId: uuid('item_id').notNull(),
    versionId: uuid('version_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.mediaId, t.versionId] })],
)
