-- Chapter paths already use the canonical path model supported by archives
-- and routing. Keep rename/recovery on that same bounded segment grammar.
DO $$DECLARE body text;updated text;BEGIN
 body:=pg_get_functiondef('app.rename_page(uuid,bigint,text,text)'::regprocedure);
 IF position('(/[a-z0-9]+(-[a-z0-9]+)*)*' IN body)=0 THEN
  updated:=replace(body,'''^[a-z0-9]+(-[a-z0-9]+)*$''','''^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$''');
  IF updated=body THEN RAISE EXCEPTION 'The page address validator insertion point changed.';END IF;
  updated:=replace(updated,'a page address uses lowercase letters, numbers and single dashes','a page address uses lowercase letters, numbers and dashes, with / between page groups');
  EXECUTE updated;
 END IF;
END$$;
