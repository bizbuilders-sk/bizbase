import {readFileSync,writeFileSync} from 'node:fs';
import {buildSourceParameters} from '../src/source-parameters.ts';
import {sourceControlPolicy} from '../src/table-field-policy.ts';
const [cataloguePath,snapshotPath]=process.argv.slice(2);
if(!cataloguePath||!snapshotPath)throw Error('Provide the private source catalogue and snapshot paths. Only field metadata is exported.');
const catalogue=JSON.parse(readFileSync(cataloguePath,'utf8')),schema=JSON.parse(readFileSync(snapshotPath,'utf8')).schema;
const records=new Map();
for(const item of catalogue){
 const key=[item.entity_type,item.source_system,item.record_type,item.source_container_id].join(':');
 let record=records.get(key);
 if(!record){record={id:key,canonical_id:'metadata-only',...item,raw_record:item.source_system==='ClickUp'?{custom_fields:[]}:{custom_fields:{}}};records.set(key,record);}
 if(item.source_system==='ClickUp')record.raw_record.custom_fields.push({id:item.field_id,name:item.field_name,type:item.field_type,value:null});
 else if(item.field_id!=='custom_fields')record.raw_record[item.field_id]=null;
}
for(const record of records.values())if(record.source_system==='Pipedrive'){
 const kind={account:'organization',contact:'person',opportunity:'deal',lead:'deal'}[record.record_type];
 if('emails' in record.raw_record)record.raw_record.emails=[];if('phones' in record.raw_record)record.raw_record.phones=[];
 for(const field of schema.fields[kind]||[])if(field.is_custom_field)record.raw_record.custom_fields[field.field_code]=null;
}
const extension=buildSourceParameters([...records.values()],schema);
const fields=Object.entries(extension.fields).flatMap(([table,list])=>list.map(field=>{const {key,label,type,sourceScope,sourceName,sourceGroupable}=field,policy=sourceControlPolicy(table,field);return {table,key,label,type,sourceScope,sourceName,sourceGroupable:Boolean(sourceGroupable),controlLabel:policy?.label,column:Boolean(policy),filter:Boolean(policy?.filter),group:Boolean(policy?.group&&sourceGroupable)};}));
writeFileSync(new URL('../docs/source-field-map.json',import.meta.url),JSON.stringify({updated:'2026-10-21',basis:'Imported ClickUp schemas and read-only Pipedrive snapshots. The full map is an audit; column/filter/group flags describe explicit table registrations. Removed fields remain in read-only record history, never an Advanced menu.',fields},null,2)+'\n');
console.log(`Exported ${fields.length} field mappings without CRM records or values.`);
