import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { layoutMode, pageStatus, sectionScope, sectionStatus, versionKind } from './enums.ts'
import { appUsers } from './identity.ts'
import { sites } from './sites.ts'

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    layoutMode: layoutMode('layout_mode').notNull().default('sections'),
    status: pageStatus('status').notNull().default('draft'),
    // The CAS token every mutation echoes. Application roles hold no UPDATE
    // grant on this column: only the commands in 0003 move it.
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    draftVersionId: uuid('draft_version_id'),
    publishedVersionId: uuid('published_version_id'),
    editorLabel: text('editor_label').notNull().default(''),
    sortIndex: integer('sort_index').notNull().default(0),
    parentPageId: uuid('parent_page_id').references((): AnyPgColumn => pages.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  t => [unique('pages_site_id_slug_key').on(t.siteId, t.slug)],
)

export const pageVersions = pgTable(
  'page_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').notNull(),
    pageId: uuid('page_id').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    content: jsonb('content').notNull(),
    meta: jsonb('meta').notNull().default({}),
    pageTitle: text('page_title').notNull(),
    pageSlug: text('page_slug').notNull(),
    // Recomputed server-side on every save; a client-supplied flag is ignored.
    carriesTrustedCode: boolean('carries_trusted_code').notNull().default(false),
    trustedCodeApprovedBy: uuid('trusted_code_approved_by').references(() => appUsers.id),
    trustedCodeApprovedAt: timestamp('trusted_code_approved_at', { withTimezone: true }),
    kind: versionKind('kind').notNull(),
    note: text('note').notNull().default(''),
    authorId: uuid('author_id').references(() => appUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    unique('page_versions_page_id_revision_key').on(t.pageId, t.revision),
    unique('page_versions_site_identity').on(t.siteId, t.id),
  ],
)

export const sectionDefs = pgTable('section_defs', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: sectionScope('scope').notNull().default('global'),
  siteId: uuid('site_id').references(() => sites.id),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull().default(''),
  status: sectionStatus('status').notNull().default('active'),
  createdBy: uuid('created_by').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** page, header or footer (ADR 0010); changed only by app.set_section_def_placement. */
  placement: text('placement').notNull().default('page'),
})

export const sectionDefVersions = pgTable(
  'section_def_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectionDefId: uuid('section_def_id')
      .notNull()
      .references(() => sectionDefs.id),
    version: integer('version').notNull(),
    sourceHtml: text('source_html').notNull(),
    // Authored and compiled are different things, and conflating them meant the
    // seed stored scoped output as "source", the manifest published it because
    // that happened to work, and revalidation recompiled it and scoped it twice
    // (migration 0013). Authored is kept for editing and audit; compiled is the
    // only thing a public manifest carries.
    sourceCss: text('source_css').notNull().default(''),
    compiledCss: text('compiled_css').notNull().default(''),
    // What the renderer consumes; public rendering never reparses authored markup
    compiledAst: jsonb('compiled_ast').notNull(),
    slots: jsonb('slots').notNull().default([]),
    sanitizerPolicyVersion: integer('sanitizer_policy_version').notNull().default(1),
    // NULL means the provenance is unknown — a row from before the split, whose
    // source_css may hold compiled output rather than anything a person wrote.
    cssPolicyVersion: integer('css_policy_version'),
    renderHash: text('render_hash').notNull(),
    // Which model this version is written in (migration 0019). Never inferred
    // from which artifact is present: a row carrying both would render as a
    // structured section to the renderer and as an interpolated one to anything
    // that reads compiled_ast, and both of those still render.
    definitionKind: text('definition_kind').notNull().default('legacy'),
    structuredDoc: jsonb('structured_doc'),
    structuredSchemaVersion: integer('structured_schema_version'),
    carriesTrustedCode: boolean('carries_trusted_code').notNull().default(false),
    thumbnailPath: text('thumbnail_path'),
    changelog: text('changelog').notNull().default(''),
    createdBy: uuid('created_by').references(() => appUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [unique('section_def_versions_section_def_id_version_key').on(t.sectionDefId, t.version)],
)
