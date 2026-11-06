-- Copied sites start private: their first Settings release has no earlier
-- public Settings version. Use the existing reviewed unpublish recovery action.
DO $$DECLARE body text;updated text;BEGIN
 body:=pg_get_functiondef('app.prepare_site_release_recovery(uuid,uuid,jsonb)'::regprocedure);
 updated:=replace(body,'IF was_unpublished THEN RAISE EXCEPTION ''The previous site settings are unavailable.'' USING ERRCODE=''CMS04'';END IF;','IF NOT was_unpublished THEN');
 IF updated=body THEN RAISE EXCEPTION 'Copied Settings recovery insertion point changed.';END IF;
 updated:=replace(updated,'PERFORM app.save_site_settings_draft(receipt.site_id,(current_item->>''revision'')::bigint,src.config);'||chr(10)||'      WHEN ''site_files'' THEN','PERFORM app.save_site_settings_draft(receipt.site_id,(current_item->>''revision'')::bigint,src.config);'||chr(10)||'        END IF;'||chr(10)||'      WHEN ''site_files'' THEN');
 EXECUTE updated;
 body:=pg_get_functiondef('app.apply_release_recovery_unpublishes(uuid)'::regprocedure);
 updated:=replace(body,'WHEN ''site_files'' THEN',$case$WHEN 'site_settings' THEN
        IF NOT app.can_administer_site(recovery.site_id) THEN RAISE EXCEPTION 'An Admin must recover site settings.' USING ERRCODE='CMS02';END IF;
        UPDATE public.site_settings SET published_version_id=NULL,revision=revision+1 WHERE id=target AND site_id=recovery.site_id;
      WHEN 'site_files' THEN$case$);
 IF updated=body THEN RAISE EXCEPTION 'Copied Settings unpublish insertion point changed.';END IF;EXECUTE updated;
 -- Preserve canonical optional blocks; old Settings only supplied a name.
 -- A copied history belongs to its destination, never the source's site name.
 body:=pg_get_functiondef('app.import_site_content_before_recipes(uuid,jsonb,jsonb)'::regprocedure);
 updated:=replace(body,'(item->''settings'')||jsonb_build_object(''name'',p_bundle->''site''->>''name'')','(item->''settings'')||CASE WHEN item#>''{settings,schemaVersion}''=''1''::jsonb OR (item->''settings'')-''name''=''{}''::jsonb THEN jsonb_build_object(''schemaVersion'',1,''name'',p_bundle->''site''->>''name'') ELSE jsonb_build_object(''name'',p_bundle->''site''->>''name'') END');
 IF updated=body THEN RAISE EXCEPTION 'Copied Settings normalization insertion point changed.';END IF;EXECUTE updated;
END$$;
