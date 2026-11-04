-- Preserve registrations and contact lineage in the existing audited staff merge.
do $$
declare definition text; needle text;
begin
 select pg_get_functiondef('public.merge_bizbase_records(text,uuid,uuid)'::regprocedure) into definition;
 needle := 'update public.activity_notes set contact_id=p_survivor_id where contact_id=p_duplicate_id;';
 if position(needle in definition)=0 then raise exception 'Contact merge definition changed';end if;
 definition:=replace(definition,needle,needle||E'\n    update public.event_participations set contact_id=p_survivor_id where contact_id=p_duplicate_id;');
 needle := 'update public.activity_notes set account_id=p_survivor_id where account_id=p_duplicate_id;';
 if position(needle in definition)=0 then raise exception 'Account merge definition changed';end if;
 definition:=replace(definition,needle,needle||E'\n    update public.event_participations set account_id=p_survivor_id where account_id=p_duplicate_id;');
 needle := 'update public.activity_notes set contact_id=target_contact_id where contact_id=c.id;';
 if position(needle in definition)=0 then raise exception 'Nested contact merge definition changed';end if;
 definition:=replace(definition,needle,needle||E'\n        update public.event_participations set contact_id=target_contact_id where contact_id=c.id;\n        insert into public.source_identity_map(entity_type,source_external_id,canonical_id) select ''contact'',source_external_id,target_contact_id from public.contacts where id in (target_contact_id,c.id) and nullif(source_external_id,'''') is not null on conflict(entity_type,source_external_id) do update set canonical_id=excluded.canonical_id;\n        update public.source_identity_map set canonical_id=target_contact_id where entity_type=''contact'' and canonical_id=c.id;');
 -- Distinct people sharing an inbox stay distinct. The duplicate primary email
 -- moves to retained notes/source details to respect unique(account_id,email).
 needle := 'if target_contact_id is null then';
 if position(needle in definition)=0 then raise exception 'Contact collision definition changed';end if;
 definition:=replace(definition,needle,$patch$
      if target_contact_id is not null and exists (
       select 1 from public.contacts t where t.id=target_contact_id and
       nullif(lower(regexp_replace(concat_ws(' ',t.first_name,t.last_name),'[^[:alnum:]]','','g')),'') is not null and
       nullif(lower(regexp_replace(concat_ws(' ',c.first_name,c.last_name),'[^[:alnum:]]','','g')),'') is not null and
       lower(regexp_replace(concat_ws(' ',t.first_name,t.last_name),'[^[:alnum:]]','','g')) <> lower(regexp_replace(concat_ws(' ',c.first_name,c.last_name),'[^[:alnum:]]','','g'))
      ) then
       update public.contacts set account_id=p_survivor_id,email=null,notes=concat_ws(E'\n',nullif(notes,''),'Retained shared email: '||c.email) where id=c.id;
       continue;
      end if;
      if target_contact_id is null then
 $patch$);
 execute definition;
end;$$;
