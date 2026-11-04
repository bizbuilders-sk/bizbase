import {buildSourceParameters,extendSourceFields} from './source-parameters.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFINITIONS, MARKETING_FIELDS, fieldValue, marketingTargetField, recordPatch, type Field, type MarketingTarget, type Row, type TableName } from './workspace-model.ts';

export type Data = Record<string, Row[]>;
export async function readAll(query: (from: number, to: number) => PromiseLike<{data: any[] | null; error: {message: string} | null}>) {
  const result: Row[] = [];
  for (let from = 0; ; from += 1000) { const {data,error} = await query(from,from+999); if (error) throw new Error(error.message); result.push(...(data || [])); if (!data || data.length < 1000) return result; }
}
export async function loadWorkspace(client: SupabaseClient): Promise<Data> {
  const tables = [...Object.keys(DEFINITIONS),'vendors','agreements','revenue_plans','crm_source_parameters'];
  const result = await Promise.all(tables.map(async (table) => [table,await readAll((from,to) => client.from(table).select('*').order('id').range(from,to))] as const));
  const data=Object.fromEntries(result);
  const {data:sourceSchema,error}=await client.from('integration_events').select('payload').eq('integration','pipedrive_schema').eq('external_event_id','ui-field-definitions-v1').maybeSingle();
  if(error)throw new Error('Source field definitions could not be loaded: '+error.message);
  const extension=buildSourceParameters(data.crm_source_parameters,sourceSchema?.payload||{});
  data.crm_source_parameters=extension.records;extendSourceFields(DEFINITIONS,extension.fields);return data;
}
export async function saveRecord(client: SupabaseClient, table: TableName, draft: Row, original: Row | undefined, data: Data, binding?: {key: string; value: string}) {
  if (table === 'event_participations' && draft.contact_id && (!original || draft.contact_id!==original.contact_id)) {
    const contact = data.contacts?.find(contact => contact.id === draft.contact_id);
    if (!contact) throw new Error('Choose an available contact.');
    draft = {...draft,account_id:contact.account_id || null};
  }
  const patch = recordPatch(table,draft,original);
  const contactId = draft.primary_contact_id || draft.contact_id;
  const retainedSourceContact = original && original.account_id === draft.account_id && (original.primary_contact_id || original.contact_id) === contactId;
  if (contactId && data.contacts?.find((contact) => contact.id === contactId)?.account_id !== draft.account_id && !retainedSourceContact) throw new Error('The selected contact belongs to a different company.');
  if (table === 'projects' && draft.agreement_id && data.agreements?.find((agreement) => agreement.id === draft.agreement_id)?.account_id !== draft.account_id) throw new Error('The agreement belongs to a different company.');
  const retainedDealLink = original && draft.account_id === original.account_id && draft.opportunity_id === original.opportunity_id;
  if (table === 'projects' && draft.opportunity_id && !retainedDealLink && data.opportunities?.find((opportunity) => opportunity.id === draft.opportunity_id)?.account_id !== draft.account_id) throw new Error('The deal belongs to a different company.');
  if (original && !Object.keys(patch).length) return original;
  let result;
  if (original) {
    if ('updated_at' in original) patch.updated_at = new Date().toISOString();
    let request = client.from(table).update(patch).eq('id',original.id);
    if (original.updated_at) request = request.eq('updated_at',original.updated_at);
    else for (const key of Object.keys(patch)) if (original[key] === null) request = request.is(key,null); else if (['string','number','boolean'].includes(typeof original[key])) request = request.eq(key,original[key]);
    result = await request.select().single();
  } else result = await client.from(table).insert({id:draft.id,...patch,...(binding ? {[binding.key]:binding.value} : {})}).select().single();
  if (result.error) {
    if (result.error.code === 'PGRST116') throw new Error('This record changed or is no longer accessible. Refresh it before saving.');
    if (result.error.code === '23505') throw new Error('A record with these details already exists. Check the company and email, or review duplicates.');
    throw new Error(result.error.message);
  }
  return result.data as Row;
}

export async function saveMarketingField(client:SupabaseClient,target:MarketingTarget,key:string,value:unknown) {
  const base=MARKETING_FIELDS.find(field=>field.key===key);if(!base)throw new Error('Unknown follow-up field.');if(base.readonly)throw new Error('This source date is read-only.');
  const field:Field=marketingTargetField(target,base);
  let next=value===''||value===undefined?null:value;
  if(field.type==='boolean'&&next!==null){if(next==='Yes'||next==='true')next=true;else if(next==='No'||next==='false')next=false;else if(typeof next!=='boolean')throw new Error('Choose Yes or No.');}
  else if(field.type==='number'&&next!==null){next=Number(next);if(!Number.isFinite(next))throw new Error('Enter a valid number.');}
  else if(next!==null)next=String(next).trim()||null;
  if(field.options&&next!==null&&!field.options.includes(String(next)))throw new Error('Choose a valid next step or option.');
  const previous=fieldValue(target.row,field);
  if(JSON.stringify(previous===''?null:previous)===JSON.stringify(next))return target.row;
  const patch:Record<string,unknown>=field.path?{[field.container!]:{...target.row[field.container!],[field.path]:next}}:{[field.key]:next};
  if(target.row.updated_at)patch.updated_at=new Date().toISOString();
  let query=client.from(target.table).update(patch).eq('id',target.row.id);
  if(target.row.updated_at)query=query.eq('updated_at',target.row.updated_at);
  else query=query.eq('marketing_fields',JSON.stringify(target.row.marketing_fields||{}));
  const {data,error}=await query.select().single();if(error){if(error.code==='PGRST116')throw new Error('This follow-up changed. Refresh before editing it.');throw new Error(error.message);}return data as Row;
}

export async function loadSources(client: SupabaseClient, row: Row) {
  const {data:aliases,error} = await client.from('source_identity_map').select('source_external_id').eq('canonical_id',row.id);
  if (error) throw new Error(error.message);
  const externalIds: string[] = [...new Set([row.source_external_id,...(aliases || []).map((alias) => alias.source_external_id)].filter(Boolean))];
  const sources = await Promise.all(externalIds.map(async (externalId) => {
    const [system,container,sourceId] = externalId.split(':');
    const type = ({organization:'account',person:'contact',deal:'opportunity',lead:'lead'} as Record<string,string>)[container];
    let query = client.from('migration_staging').select('*').eq('source_system',system).eq('source_record_id',sourceId);
    query = system === 'ClickUp' ? query.eq('source_container_id',container) : query.eq('record_type',type || container);
    const {data,error:sourceError} = await query; if (sourceError) throw new Error(sourceError.message); return data || [];
  }));
  const {data:schema} = await client.from('integration_events').select('payload').eq('integration','pipedrive_schema').eq('external_event_id','ui-field-definitions-v1').maybeSingle();
  return {sources:sources.flat() as Row[],schema:schema?.payload || {}};
}

export function sourceFields(source: Row, schema: any): {label: string; value: string}[] {
  const raw = source.raw_record || {};
  const readable = (value: any): string => {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.map(readable).join(', ') || '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') { if (value.value !== null && value.value !== undefined && typeof value.value !== 'object') return `${value.value}${value.label ? ` (${value.label})` : value.currency ? ` ${value.currency}` : ''}`; if (value.label || value.name || value.title || value.email || value.username) return String(value.label || value.name || value.title || value.email || value.username); return Object.entries(value).map(([key,item]) => `${key.replaceAll('_',' ')}: ${readable(item)}`).join(' · '); }
    return String(value);
  };
  if (source.source_system === 'ClickUp') {
    const fields = (raw.custom_fields || []).map((field: any) => {
      const options = field.type_config?.options || []; let value = field.value;
      if (field.type === 'drop_down') value = options.find((option: any) => String(option.orderindex) === String(value) || option.id === value)?.name ?? value;
      if (field.type === 'labels') value = (Array.isArray(value) ? value : [value]).map((id: any) => options.find((option: any) => option.id === id)?.label || id);
      if (field.type === 'date' && /^\d{12,}$/.test(String(value))) value = new Date(Number(value)).toLocaleDateString('en-GB');
      if (field.type === 'list_relationship' && Array.isArray(value)) value = value.map((item: any) => item.name || item.title || 'Linked record');
      return {label:field.name || 'Imported field',value:readable(value)};
    });
    const sourceDate=(value:any)=>value?new Date(/^\d+$/.test(String(value))?Number(value):value).toLocaleString('en-GB'):'—';
    return [{label:'Created on',value:sourceDate(raw.date_created)},{label:'Source name',value:readable(raw.name)},{label:'Source status',value:readable(raw.status?.status || raw.status)},{label:'Assigned to',value:readable(raw.assignees)},{label:'Start date',value:sourceDate(raw.start_date)},{label:'Due date',value:sourceDate(raw.due_date)},{label:'Closed on',value:sourceDate(raw.date_closed)},{label:'Priority',value:readable(raw.priority?.priority || raw.priority)},{label:'Tags',value:readable(raw.tags)},...fields,{label:'Description',value:readable(raw.description || raw.text_content)},{label:'Attachments',value:readable((raw.attachments||[]).map((item:any)=>item.title||item.name||'Attachment'))}];
  }
  const kind = ({account:'organization',contact:'person',opportunity:'deal',lead:'deal'} as Record<string,string>)[source.record_type];
  const defs: any[] = schema.fields?.[kind] || [];
  const hidden = new Set(['id','custom_fields','org_id','person_id','visible_to','is_deleted','picture_id','creator_user_id','origin_id','channel_id']);
  return Object.entries({...raw,...raw.custom_fields}).filter(([key]) => !hidden.has(key)).map(([key,value]) => {
    const def = defs.find((item) => item.field_code === key); let display = value;
    if (def?.options) display = Array.isArray(value) ? value.map((item) => def.options.find((option: any) => String(option.id) === String(item))?.label || item) : def.options.find((option: any) => String(option.id) === String(value))?.label ?? value;
    if (key === 'owner_id') display = schema.users?.find((user: any) => user.id === value)?.name || value;
    if (key === 'pipeline_id') display = schema.pipelines?.find((pipeline: any) => pipeline.id === value)?.name || value;
    if (key === 'stage_id') display = schema.pipelines?.flatMap((pipeline: any) => pipeline.stages || []).find((stage: any) => stage.id === value)?.name || value;
    return {label:def?.field_name || key.replaceAll('_',' ').replace(/^\w/,letter => letter.toUpperCase()),value:readable(display)};
  });
}
