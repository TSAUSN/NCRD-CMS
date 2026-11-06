-- 0022 — page metadata has a shape, and the database is the layer that knows it.
--
-- Finding S-02: `SeoMeta` was exported from @cms/schema and never imported.
-- Nothing called `SeoMeta.parse`, so every constraint it declared was
-- aspirational and the only real bound on a page's metadata was the 1 MiB
-- whole-content cap in migration 0001. TypeScript now validates at the save
-- boundary (`parsePageMeta`), but `app.save_page_draft` is EXECUTE to
-- cms_authenticated_user, so any role that can reach the command can write the
-- column without going through it — and the seeds and any future importer are
-- callers too.
--
-- A CHECK constraint rather than a guard inside the command, deliberately. The
-- command is one caller; the constraint is every caller, including a hand-run
-- UPDATE, a restore, and whatever writes this column in five years. It is also
-- the one place that cannot be forgotten by a caller that did not know it
-- existed, which is exactly how S-02 happened.
--
-- The limits match packages/schema/src/content/seo.ts and must stay equal to
-- it. They are bounds on a `<head>`, not security limits — every one of these
-- values is escaped at its sink — but a field with no bound is a field that
-- eventually holds a novel.

/**
 * What is wrong with a page's metadata, or NULL.
 *
 * Deliberately the same shape as the other `*_defect` functions in this schema:
 * a specific sentence or nothing, never a boolean, so the constraint violation
 * can say which field and why.
 */
CREATE OR REPLACE FUNCTION app.page_meta_defect(p_meta jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE stray text;
BEGIN
  -- A missing meta object and an empty one both mean "nothing said", which is
  -- what a page starts with.
  IF p_meta IS NULL OR COALESCE(jsonb_typeof(p_meta), 'null') = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_meta) <> 'object' THEN
    RETURN 'page metadata is not an object';
  END IF;

  -- Unknown keys are refused rather than ignored, matching SeoMeta's
  -- strictObject. Stripping them silently deletes whatever an older or newer
  -- build stored, and the loss is invisible.
  SELECT k INTO stray FROM jsonb_object_keys(p_meta) AS k
   WHERE k NOT IN ('title', 'description', 'canonical', 'social_image', 'noindex')
   LIMIT 1;
  IF stray IS NOT NULL THEN
    RETURN format('page metadata carries %s, which is not a metadata field', stray);
  END IF;

  IF COALESCE(jsonb_typeof(p_meta -> 'title'), 'string') NOT IN ('string', 'null') THEN
    RETURN 'the page title is not text';
  END IF;
  IF length(COALESCE(p_meta ->> 'title', '')) > 512 THEN
    RETURN 'the page title is longer than 512 characters';
  END IF;

  IF COALESCE(jsonb_typeof(p_meta -> 'description'), 'string') NOT IN ('string', 'null') THEN
    RETURN 'the page description is not text';
  END IF;
  IF length(COALESCE(p_meta ->> 'description', '')) > 2048 THEN
    RETURN 'the page description is longer than 2048 characters';
  END IF;

  IF COALESCE(jsonb_typeof(p_meta -> 'canonical'), 'string') NOT IN ('string', 'null') THEN
    RETURN 'the canonical URL is not text';
  END IF;
  -- Longer than any address a browser or crawler honours. Whether the URL names
  -- this site is a different question entirely, and one this layer cannot
  -- answer: it does not know which host is verified. The renderer does, and
  -- refuses everything else on every publish path.
  IF length(COALESCE(p_meta ->> 'canonical', '')) > 2048 THEN
    RETURN 'the canonical URL is longer than 2048 characters';
  END IF;

  IF COALESCE(jsonb_typeof(p_meta -> 'social_image'), 'string') NOT IN ('string', 'null') THEN
    RETURN 'the social image is not text';
  END IF;
  IF length(COALESCE(p_meta ->> 'social_image', '')) > 2048 THEN
    RETURN 'the social image URL is longer than 2048 characters';
  END IF;

  IF COALESCE(jsonb_typeof(p_meta -> 'noindex'), 'boolean') NOT IN ('boolean', 'null') THEN
    RETURN 'the noindex flag is not true or false';
  END IF;

  RETURN NULL;
END
$$;

-- Every existing row is checked, not trusted: NOT VALID would let whatever is
-- already stored stay unexamined, and "the rows that predate the rule" is the
-- category a restore quietly adds to.
ALTER TABLE public.page_versions
  ADD CONSTRAINT page_versions_meta_shape
  CHECK (app.page_meta_defect(meta) IS NULL);

REVOKE ALL ON FUNCTION app.page_meta_defect(jsonb) FROM PUBLIC;

DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public_api')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner', obj.sig);
  END LOOP;
END
$$;
