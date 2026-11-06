-- Published chapter slugs are stable map identities; no contacts or draft values are exposed.
CREATE OR REPLACE FUNCTION app.chapter_directory_for_site(p_site uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('slug',c.slug,'name',v.config->>'name','path',CASE WHEN v.config->>'destination'='page' THEN r.path END,'externalUrl',CASE WHEN v.config->>'destination' IN('external','division') THEN v.config->>'externalUrl' END)||CASE WHEN v.config->>'destination'='division' THEN jsonb_build_object('destination','division') ELSE '{}'::jsonb END ORDER BY lower(v.config->>'name'),c.id),'[]'::jsonb)
 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.published_version_id
 LEFT JOIN public.published_routes r ON r.site_id=c.site_id AND r.page_id=(v.config->>'pageId')::uuid
 WHERE c.site_id=p_site AND (v.config->>'destination' IN('external','division') OR (v.config->>'destination'='page' AND r.page_id IS NOT NULL))
$function$;
