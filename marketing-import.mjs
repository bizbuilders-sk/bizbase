import {sourceUuid, sourceField, displayField} from './migration-core.mjs';
import {extractMarketingFields,populatedSourceField} from './marketing-fields.mjs';

export const MARKETING_LISTS = new Set(['901516689943','901523643875','901523553561','1200920000003188']);
const text = value => String(value ?? '').trim();
const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const companyKey = value => normalize(value).replace(/\s+(s r o|sro|a s)$/,'').trim();
const emailOf = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value)) ? text(value).toLowerCase() : null;
const fullName = row => [row.first_name,row.last_name].filter(Boolean).join(' ');
const get = (raw,name) => displayField(populatedSourceField(raw,name)).trim();
const yes = (raw,name) => [true,'true'].includes(sourceField(raw,name)?.value);
const dateTime = value => {if(value===null||value===undefined||value==='')return null;const d=new Date(/^\d+$/.test(String(value))?Number(value):value);return Number.isNaN(d.getTime())?null:d.toISOString();};
const compatibleName = (left,right) => !left || !right || normalize(left)===normalize(right) || (normalize(left).length>5 && normalize(right).startsWith(normalize(left)+' ')) || (normalize(right).length>5 && normalize(left).startsWith(normalize(right)+' '));
const plausibleCompany = value => companyKey(value).length>1 && !['n a','na','none','nezadane','neuvedene','unknown','private'].includes(companyKey(value));

export function salesSignal(raw) {
  if(normalize(get(raw,'EVENT'))==='contact form')return {label:'Enquiry',basis:'Contact form submission'};
  if(yes(raw,'Záujem o vypracovanie auditu zdarma?'))return {label:'Requested audit',basis:'Explicit free-audit request'};
  if(yes(raw,'KONZULTÁCIA'))return {label:'Requested meeting',basis:'Explicit consultation request'};
  return null;
}
export function marketingEvent(raw,list) {
  const field=sourceField(raw,'EVENT');const label=get(raw,'EVENT');
  if(normalize(label)==='contact form')return null;
  const name=label || (list.name==='LEADY FINAL REPORT'?'2026 PRIESKUM · Final report':`${list.folder} · event not recorded`);
  const option=field?.type_config?.options?.find(item=>String(item.orderindex)===String(field.value)||item.id===field.value);
  const key=option?.id || `${list.id}:unrecorded-event`;
  const exact=name.match(/^(\d{4}-\d{2}-\d{2})\b/);const starts=exact&&dateTime(exact[1])?.slice(0,10)===exact[1]?exact[1]:null;
  const monthly=name.match(/^(\d{4}-\d{2})(?:\b|\s)/);const onDemand=name.match(/ON-DEMAND\s+(\d{2})-(\d{2})/i);
  const event_type=/biztalk/i.test(name)?'Biztalks':/webinar/i.test(name)?'Webinar':/on-demand/i.test(name)?'On-demand':/prieskum|report/i.test(name)?'Survey':'Other';
  return {key,name,event_type,starts_on:starts,period:monthly?.[1]||(onDemand?`20${onDemand[2]}-${onDemand[1]}`:/2026/.test(name)?'2026':null),source_external_id:`ClickUp:event:${key}`,notes:label?null:'The exact event was not recorded in the source; no event date or attendance has been inferred.'};
}

export async function buildMarketingImport(snapshot,existing={}) {
  const tables={accounts:[],contacts:[],events:[],intake_leads:[],event_participations:[],source_identity_map:[],migration_staging:[]};
  const accounts=[...(existing.accounts||[])], contacts=[...(existing.contacts||[])], leads=[...(existing.leads||[])];
  const identities=new Map((existing.identities||[]).map(row=>[`${row.entity_type}:${row.source_external_id}`,row.canonical_id]));
  for(const row of accounts)if(row.source_external_id)identities.set(`account:${row.source_external_id}`,row.id);
  for(const row of contacts)if(row.source_external_id)identities.set(`contact:${row.source_external_id}`,row.id);
  const knownEvents=new Map((existing.events||[]).map(row=>[row.source_external_id,row]));
  const knownParticipation=new Map((existing.event_participations||[]).map(row=>[row.source_external_id,row]));
  const stats={source_records:0,new_accounts:0,new_contacts:0,linked_contacts:0,unresolved_contacts:0,explicit_requests:0,linked_existing_leads:0,new_leads:0,registrations:0,unassigned_contacts:0};const issues=[];const seen=new Set();
  const alias=(type,external,id)=>{if(!id||identities.has(`${type}:${external}`))return;identities.set(`${type}:${external}`,id);tables.source_identity_map.push({entity_type:type,source_external_id:external,canonical_id:id});};
  for(const list of snapshot.lists||[]) {
    if(!MARKETING_LISTS.has(list.id))throw new Error(`Out-of-scope marketing list: ${list.id}`);
    for(const raw of list.tasks||[]) {
      const external=`ClickUp:${list.id}:${raw.id}`;
      if(!raw.id||seen.has(external))throw new Error('Missing or duplicate source identity');seen.add(external);stats.source_records++;
      const company=get(raw,'COMPANY');const rawEmail=get(raw,'EMAIL');const email=emailOf(rawEmail)||emailOf(raw.name);
      const name=get(raw,'NAME') || (emailOf(raw.name)?'':text(raw.name).replace(/^ID\d+:\s*/,''));const phone=get(raw,'PHONE')||raw.custom_fields?.find(field=>field.type==='phone'&&field.value)?.value||null;
      const website=get(raw,'Website');const registered=dateTime(sourceField(raw,'DATE')?.value)||dateTime(sourceField(raw,'Report Lead Date')?.value)||dateTime(raw.date_created);
      const notes=[get(raw,'Notes'),get(raw,'Next step (Poznámky)'),get(raw,'Poznamka k DC'),get(raw,'Kontakt poznámky'),get(raw,'info k DC'),raw.archived?'Archived in ClickUp':null].filter(Boolean).join('\n')||null;
      const warnings=[];let account=accounts.find(row=>row.id===identities.get(`account:${external}`));let contact=contacts.find(row=>row.id===identities.get(`contact:${external}`));
      const companyMatches=plausibleCompany(company)?accounts.filter(row=>companyKey(row.name)===companyKey(company)):[];
      if(!account&&companyMatches.length===1)account=companyMatches[0];
      if(!contact&&email) {
        const sameEmail=contacts.filter(row=>emailOf(row.email)===email);
        const candidates=sameEmail.filter(row=>compatibleName(name,fullName(row))&&(!account||row.account_id===account.id));
        if(candidates.length===1)contact=candidates[0];
        else if(sameEmail.length)warnings.push('Email identity is ambiguous or conflicts with the supplied name/company; link a contact after review.');
      }
      if(contact) {stats.linked_contacts++;account=accounts.find(row=>row.id===contact.account_id);if(company&&account&&companyKey(company)!==companyKey(account.name))warnings.push('Reported company differs from the existing contact affiliation; original company retained.');}
      else if(!warnings.length) {
        if(!account&&companyMatches.length>1)warnings.push('Several existing companies match this name; contact remains unassigned.');
        if(!account&&companyMatches.length===0&&plausibleCompany(company)) {
          account={id:await sourceUuid('marketing-account',companyKey(company)),name:company,kind:'Lead',qualification_status:'Unreviewed',source:'ClickUp',source_external_id:external,data_quality_status:'Needs review',website:/^https?:\/\//i.test(website)?website:null};
          accounts.push(account);tables.accounts.push(account);stats.new_accounts++;
        }
        if(name||email) {
          contact={id:await sourceUuid('marketing-contact',external),account_id:account?.id||null,first_name:name||null,last_name:null,email,phone,is_primary:false,source_external_id:external,notes:'Imported marketing contact. Full source name retained; no sales qualification inferred.'};
          contacts.push(contact);tables.contacts.push(contact);stats.new_contacts++;if(!account)stats.unassigned_contacts++;
        }else warnings.push('No usable name or email; source retained for contact review.');
      }
      if(!contact)stats.unresolved_contacts++;
      alias('account',external,account?.id);alias('contact',external,contact?.id);
      const signal=salesSignal(raw);if(signal)stats.explicit_requests++;
      const event=marketingEvent(raw,list);let eventRow=null;
      if(event) {
        eventRow=knownEvents.get(event.source_external_id);
        if(!eventRow){eventRow={...event,id:await sourceUuid('marketing-event',event.key)};delete eventRow.key;knownEvents.set(event.source_external_id,eventRow);tables.events.push(eventRow);}
      }
      let lead=null;
      const existingBySource=leads.find(row=>row.source_external_id===external);
      if(existingBySource)lead=existingBySource;
      else if(signal) {
        const matches=leads.filter(row=>(contact&&row.contact_id===contact.id)||(email&&emailOf(row.raw_submission?.email)===email));
        if(matches.length===1){lead=matches[0];stats.linked_existing_leads++;}
        else {
          lead={id:await sourceUuid('marketing-lead',external),account_id:account?.id||null,contact_id:contact?.id||null,source:'ClickUp',source_form:event?.name||'Contact form',source_external_id:external,submitted_at:registered||snapshot.fetched_at,raw_submission:{company_name:company||name||email||'Enquiry',contact_name:name||null,email,phone,message:[signal.basis,notes,get(raw,'INTEREST')].filter(Boolean).join('\n'),interest_basis:signal.basis,source_list:list.name,source_record_id:raw.id,...(eventRow?{event_id:eventRow.id}:{})},journey_status:normalize(get(raw,'Next step'))==='nemaju zaujem o dc'?'Disqualified':['neoslovujeme','uz spolupracujeme','nereaguje bez odpovede'].includes(normalize(get(raw,'Next step')))?'Nurture':'New lead',review_status:'Needs review',history_scan_status:contact?'Possible match':'Not run',finstat_status:'Not checked'};
          if(!eventRow){const captured=extractMarketingFields(raw);lead.marketing_fields={...captured.marketing_fields,follow_up:captured.follow_up};}
          leads.push(lead);tables.intake_leads.push(lead);stats.new_leads++;
        }
      }
      if(eventRow) {
        const previous=knownParticipation.get(external);
        if(!previous)tables.event_participations.push({id:await sourceUuid('marketing-participation',external),event_id:eventRow.id,contact_id:contact?.id||null,account_id:account?.id||null,name:name||email||text(raw.name)||'Unidentified registration',company_name:company||null,email,phone,registered_at:registered,participation_status:'Unknown',sales_interest:signal?.label||'Not recorded',...extractMarketingFields(raw),notes:[notes,...warnings].filter(Boolean).join('\n')||null,source:'ClickUp',source_external_id:external,intake_lead_id:lead?.id||null,review_status:contact?'Needs review':'Conflict'});
        stats.registrations++;
      }
      const staging={id:await sourceUuid(list.id,raw.id),source_system:'ClickUp',source_space:`SALES & MARKETING / ${list.folder}`,source_container_id:list.id,source_container_name:list.name,source_record_id:raw.id,source_record_url:raw.url||`https://app.clickup.com/t/${raw.id}`,source_updated_at:dateTime(raw.date_updated),record_type:eventRow?'event_participation':'lead',raw_record:raw,proposed_account_id:account?.id||null,validation_status:warnings.length?'Conflict':'Needs review',validation_notes:[signal?.basis||'Marketing participation only; no sales intent inferred.',...warnings].join(' ')};
      tables.migration_staging.push(staging);
      if(warnings.length)issues.push({source_external_id:external,warnings});
    }
  }
  return {tables,stats,issues};
}
