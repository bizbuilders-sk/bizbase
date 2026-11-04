import {readFileSync,writeFileSync} from 'node:fs';
import {DEFINITIONS} from '../src/workspace-model.ts';
const load=p=>JSON.parse(readFileSync(p,'utf8'));
const catalog=load('docs/entity-field-review-2026-10-27.json').catalog;
const samples=new Map(load('outputs/data-cleanup-field-examples-2026-10-27.json').map(r=>[r.entity+':'+r.key,r.samples]));
const counts=load('outputs/data-cleanup-value-counts-2026-10-27.json');
const sourceMap=load('docs/source-field-map.json').fields;
const single={contacts:'Contact',accounts:'Company',opportunities:'Deal',projects:'Project',services:'Service',opportunity_services:'Deal service',project_services:'Project service',vendor_costs:'Vendor cost',event_participations:'Event response'};
const get=(table,key)=>samples.get(table+':'+key)||[];
const show=v=>v===true?'Yes':v===false?'No':Array.isArray(v)?v.map(show).join(', '):v&&typeof v==='object'?(v.name||v.label||v.value||'Linked record'):String(v??'');
const short=v=>{const s=show(v).replace(/\s+/g,' ').trim();return s.length>55?s.slice(0,52)+'…':s;};
function backing(table,field,meta){
 if(meta?.linked)return [meta.linked.table,meta.linked.field];
 if(meta?.registrationKey){const f=DEFINITIONS.event_participations.fields.find(f=>f.key===meta.registrationKey);return ['event_participations',f?.path?'marketing_fields.'+f.path:meta.registrationKey];}
 if(meta?.path)return [table,(meta.container||'raw_submission')+'.'+meta.path];
 if(field.key==='event_ids')return ['event_participations','event_id'];
 if(field.key==='proposed_services')return ['opportunity_services','service_name'];
 return [table,field.key];
}
const entity=[],linked=[],values=[];
const mapping={};
for(const t of catalog)for(const field of t.fields){
 const meta=DEFINITIONS[t.table].fields.find(f=>f.key===field.key)||sourceMap.find(f=>f.table===t.table&&f.key===field.key);
 const [owner,key]=backing(t.table,field,meta);
 const sample=(meta?.relation==='vendors'?get('vendor_costs','vendor_name'):get(owner,key)).slice(0,3).map(x=>short(x.value)).filter(Boolean);
 const isLinked=!!meta?.linked||!!meta?.registrationScope||!!meta?.eventScope||field.key.startsWith('company__');
 let rule=meta?.linked?`${single[meta.linked.table]}: ${meta.linked.field}`:meta?.registrationScope?'Event response, scoped to the selected event':meta?.eventScope?'Linked event membership':field.home==='Imported snapshot'?'Read-only imported field':field.key==='received_on'?'Earliest original source receipt':field.key==='added_on'?'Date inserted into BizBase':field.key==='lead_status'?'Company qualification: New / SQL / No Lead':field.key==='lifecycle'?'Follows Lead status; Customer / Former customer can be changed manually':field.key==='proposed_services'?'Service lines linked to the Deal':meta?.relation?`Links to ${meta.relation}`:meta?.path?`${meta.container||'raw_submission'}.${meta.path}`:'BizBase master value';
 let issue='';
 if(field.key==='company_size'&&t.table==='accounts')issue='No values recorded; previously placed in TBD.';
 else if(field.filled===0)issue='No recorded values. Decide whether the field is useful.';
 else if(field.readonly)issue='Linked, calculated or imported value; review display rather than source history.';
 if(field.requiredOnCreation)issue=(issue?issue+' ':'')+'Required for new records.';
 if(field.key==='amount'&&t.table==='opportunities')issue='140 Deals show €0. Review individually; do not bulk convert.';
 if(field.key==='contract_value'&&t.table==='projects')issue='181 historical contracts are unknown. Blank is not zero.';
 if(field.key==='project_group')issue='205 unassigned; may be intentional. SLSP was explicitly left ungrouped.';
 const row=[isLinked?t.title:single[t.table],field.label,sample.join('\n')||(field.filled===0?'No recorded values':'No direct sample available'),field.column?'Yes':'No',field.filter?'Yes':'No',field.group?'Yes':'No',field.key==='company_size'&&t.table==='accounts'?'Review':'Keep',meta?.relation?'Relationship':field.type,field.home,rule,issue,t.table,field.key,''];
 (isLinked?linked:entity).push(row);
 mapping[t.table+':'+field.key]={owner,key};
 if(isLinked)continue;
 const choices=field.type==='boolean'?['Yes','No']:field.options;
 if(!choices?.length)continue;
 const observed=counts.filter(c=>c.entity===owner&&c.key===key);
 const available=[...choices];for(const c of observed){const v=show(c.value);if(!available.includes(v))available.push(v);}
 for(const value of available){const used=observed.filter(c=>show(c.value)===value).reduce((n,c)=>n+Number(c.n),0);const covered=observed.length>0;
  values.push([single[t.table],field.label,value,'',choices.includes(value)?'Keep':'Review',covered?used:null,field.readonly?'Imported display / mapping':'BizBase value',t.table,field.key,choices.includes(value)?'':'Recorded value outside the current choices']);
 }
 if((field.type==='select'||meta?.nullableBoolean)&&!field.requiredOnCreation&&field.filled!==null&&field.filled<t.records){
  values.push([single[t.table],field.label,'Unassigned (blank)','','Keep',t.records-field.filled,'Display for blank value',t.table,field.key,'Represents a missing value, not a stored option or zero.']);
 }
}
const data={date:'2026-10-27',entity,linked,values,mapping};
writeFileSync('/private/tmp/bizbase-field-workbook-20261027/input.json',JSON.stringify(data,null,2));
console.log(JSON.stringify({entityFields:entity.length,linkedDisplays:linked.length,valueChoices:values.length}));
