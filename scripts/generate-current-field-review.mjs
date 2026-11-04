import {readFileSync,writeFileSync} from 'node:fs';
import {DEFINITIONS,tableColumnFields,tableFilterFields,groupFields} from '../src/workspace-model.ts';
import {extendSourceFields} from '../src/source-parameters.ts';

const root=new URL('../',import.meta.url);
const read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const populations=read('docs/field-population-2026-10-27.json').fields;
const distribution=read('docs/field-value-distributions-2026-10-27.json').values;
const sourceMap=read('docs/source-field-map.json');
const sourceFields={};
for(const field of sourceMap.fields)(sourceFields[field.table]??=[]).push({...field,sourceParameter:true,readonly:true,visible:false,groupSection:'Source history'});
extendSourceFields(DEFINITIONS,sourceFields);
const labels={contacts:'Contacts',accounts:'Companies',opportunities:'Deals',projects:'Projects',services:'Service catalog',opportunity_services:'Deal services',project_services:'Project services',vendor_costs:'Vendor costs',event_participations:'Event participation'};
const tables=Object.keys(labels);
const lookup=new Map(populations.map(row=>[`${row.entity}:${row.key}`,row]));
function home(field,table){
 if(field.linked)return field.linked.table==='accounts'?'Linked Company':'Linked Contact';
 if(field.registrationScope||field.eventScope)return 'Event / response';
 if(field.sourceParameter)return 'Imported snapshot';
 if(field.derived)return 'Calculated';
 if(field.path)return 'Nested source or response';
 if(field.relation)return 'Relationship';
 return labels[table];
}
function usage(field,table){
 if(field.sourceParameter||field.linked||field.registrationScope||field.eventScope||field.derived||field.path)return null;
 return lookup.get(`${table}:${field.key}`)||null;
}
const catalog=tables.map(table=>{
 const columns=new Set(tableColumnFields(table).map(f=>f.key));
 const filters=new Set(tableFilterFields(table).map(f=>f.key));
 const groups=new Set(groupFields(table).map(f=>f.key));
 const total=populations.find(x=>x.entity===table)?.total||0;
 return {table,title:labels[table],records:total,fields:DEFINITIONS[table].fields.map(field=>({
  key:field.key,label:field.label,home:home(field,table),type:field.type||'text',options:field.options||[],
  filled:usage(field,table)?.filled??null,readonly:!!field.readonly,
  requiredOnCreation:!!field.required||(['projects','opportunities'].includes(table)&&['account_id','primary_contact_id'].includes(field.key))||table==='projects'&&field.key==='contract_value',
  column:columns.has(field.key),filter:filters.has(field.key),group:groups.has(field.key)
 }))};
});
const result={date:'2026-10-27',note:'Based on the current frontend field definitions, the previously captured source-field map, and a live aggregate snapshot. It contains no individual CRM records.',catalog,distribution};
writeFileSync(new URL('docs/entity-field-review-2026-10-27.json',root),JSON.stringify(result,null,2));
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const flag=value=>value?'Yes':'—';
const rows=table=>table.fields.map(f=>`<tr><td><strong>${esc(f.label)}</strong><small>${esc(f.key)}</small></td><td>${esc(f.home)}</td><td>${f.filled===null?'—':`${f.filled} / ${table.records}`}</td><td>${flag(f.column)}</td><td>${flag(f.filter)}</td><td>${flag(f.group)}</td><td>${f.requiredOnCreation?'Required for new record':f.readonly?'Read-only':'Editable'}</td><td>${esc(f.options.join(' · ')||'—')}</td></tr>`).join('');
const values=distribution.map(v=>`<tr><td>${esc(v.field.replaceAll('_',' '))}</td><td>${esc(v.value)}</td><td>${v.n}</td></tr>`).join('');
const sections=catalog.map(t=>`<section id="${esc(t.table)}"><h2>${esc(t.title)} <small>${t.records} records</small></h2><div class="scroll"><table><thead><tr><th>Field</th><th>Belongs to</th><th>Populated</th><th>Column</th><th>Filter</th><th>Group</th><th>Editing</th><th>Choices</th></tr></thead><tbody>${rows(t)}</tbody></table></div></section>`).join('');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BizBase fields and values</title><style>body{margin:0;background:#f2f6f6;color:#1b303a;font:15px/1.5 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:30px}h1{font-size:32px}section{background:white;border:1px solid #dce4e5;border-radius:10px;padding:24px;margin:20px 0}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#5032ca}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #e1e6e8;padding:10px;text-align:left;vertical-align:top}th{background:#f2f4f5}td:first-child{min-width:150px}td:last-child{min-width:180px}small{display:block;color:#647781;font-size:11px}h2 small{display:inline;font-size:14px}p{max-width:1100px}</style><main><h1>BizBase fields and values</h1><p>Current entity field dictionary and database population snapshot · 27 October 2026. Column, Filter and Group mean a field is eligible for that control; each person's saved layout and the data in the current view determine what is shown. Zero and No count as populated values. Dashes mean a field is linked, calculated, nested or imported, so this snapshot does not count it directly.</p><p>Companies own Lead status and Lifecycle. Contacts link to Companies; Deals and Projects have their own stages and values. Event responses stay attached to their source event and can be viewed from the related Company or Contact. Source-projected fields use the captured schema from 21 October; newly discovered source fields may differ. No individual CRM values are shown in this report.</p><nav>${catalog.map(t=>`<a href="#${esc(t.table)}">${esc(t.title)}</a>`).join('')}<a href="#distribution">Classification values</a></nav>${sections}<section id="distribution"><h2>Classification values currently in BizBase</h2><table><thead><tr><th>Field</th><th>Value</th><th>Records</th></tr></thead><tbody>${values}</tbody></table></section></main></html>`;
writeFileSync(new URL('docs/entity-field-review-2026-10-27.html',root),html);
console.log(`Documented ${catalog.reduce((n,t)=>n+t.fields.length,0)} field entries across ${catalog.length} tables.`);
