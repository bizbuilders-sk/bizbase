import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFINITIONS,fieldValue,relatedFieldValue,recordPatch,restoreView,tableColumnFields,tableFilterFields,groupFields,contactDetails,setField} from '../src/workspace-model.ts';
import {buildSourceParameters,extendSourceFields} from '../src/source-parameters.ts';

test('Company review decisions remove fields and filter-only revenue range survives saved layouts',()=>{
 const removed=['contacts_count','qualification_status','qualification_score','qualification_notes','source','source_system','acquisition_channel','data_quality_status'];
 assert.ok(removed.every(key=>!DEFINITIONS.accounts.fields.some(f=>f.key===key)));
 const columns=tableColumnFields('accounts').map(f=>f.key),filters=tableFilterFields('accounts').map(f=>f.key);
 // 4 Nov 2026 field review: Company ID is a column; size, website and address are Company card only.
 assert.ok(!columns.some(key=>['added_on','finstat_url','address','revenue_band','company_size','website'].includes(key)));
 assert.ok(columns.includes('registration_number'));
 assert.ok(DEFINITIONS.accounts.fields.some(f=>f.key==='finstat_url'));
 assert.ok(DEFINITIONS.accounts.fields.some(f=>f.key==='company_size'),'card-only fields stay on the record');
 assert.ok(!filters.includes('received_on')&&filters.includes('revenue_band'));
 assert.ok(groupFields('accounts').some(f=>f.key==='revenue_band'));
 const saved=restoreView({visibleKeys:['name','contacts_count','added_on'],filters:[{id:'revenue',field:'revenue_band',operator:'eq',value:'1 000 000 +'},{id:'old',field:'qualification_status',operator:'eq',value:'Qualified'}],groupBy:'revenue_band'},'accounts');
 assert.deepEqual(saved.visibleKeys,['name']);assert.deepEqual(saved.filters.map(f=>f.id),['revenue']);assert.equal(saved.groupBy,'revenue_band');
});

test('Industry uses the verified Pipedrive choices without writing a conversion during unrelated edits',()=>{
 const industry=DEFINITIONS.accounts.fields.find(f=>f.key==='industry');
 assert.equal(industry.type,'select');assert.equal(industry.options.length,20);
 const company={id:'company',...DEFINITIONS.accounts.defaults,name:'Client',industry:'8'};
 assert.equal(fieldValue(company,industry),'Financial services');
 const contact={id:'contact',account_id:'company'};
 assert.equal(relatedFieldValue({accounts:[company]},contact,DEFINITIONS.contacts.fields.find(f=>f.key==='company_industry')),'Financial services');
 assert.deepEqual(recordPatch('accounts',{...company,name:'Renamed'},company),{name:'Renamed'});
 assert.deepEqual(recordPatch('accounts',{...company,industry:'Manufacturing'},company),{industry:'Manufacturing'});
 assert.throws(()=>recordPatch('accounts',{...company,industry:'999'}, {...company,industry:'Manufacturing'}),/industry/i);
});

test('Contact Email and Phone preserve every imported value without duplicate source columns or source writes',()=>{
 const raw={id:'source',entity_type:'contact',canonical_id:'contact',source_system:'Pipedrive',record_type:'contact',raw_record:{emails:[{value:'Person@company.test'},{value:'second@personal.test'}],phones:[{value:'+421 900 123 456'},{value:'+421900999000'}]}};
 const schema={fields:{person:[{field_code:'emails',field_name:'Email',field_type:'varchar'},{field_code:'phones',field_name:'Phone',field_type:'phone'}]}};
 const source=structuredClone(raw),built=buildSourceParameters([raw],schema),data={crm_source_parameters:built.records};
 const contact={id:'contact',email:'person@company.test',phone:'+421900123456'};
 assert.deepEqual(contactDetails(data,contact,'email'),['person@company.test','second@personal.test']);
 assert.deepEqual(contactDetails(data,contact,'phone'),['+421900123456','+421900999000']);
 const defs=structuredClone(DEFINITIONS);extendSourceFields(defs,built.fields);
 assert.ok(!defs.contacts.fields.some(f=>f.sourceParameter));
 assert.ok(['email','phone'].every(key=>tableFilterFields('contacts').some(f=>f.key===key)),'Email and Phone can be filtered (e.g. empty / not empty)');
 assert.deepEqual(recordPatch('contacts',{...contact,first_name:'Person'},contact),{first_name:'Person'});
 assert.deepEqual(raw,source);
});

test('client and vendor Invoice email share one field and old layout keys migrate to it',()=>{
 const key='7dd6aa04-ee13-4448-bc4a-bce8d7182d08';
 const records=['client-list','vendor-list'].map((id,i)=>({id,entity_type:'account',canonical_id:'company',source_system:'ClickUp',source_container_id:id,source_container_name:i?'VENDORS':'CLIENTS',record_type:i?'vendor':'account',raw_record:{custom_fields:[{id:key,name:'Invoice email',type:'email',value:i?'vendor@company.test':'billing@company.test'}]}}));
 const built=buildSourceParameters(records,{}),data={crm_source_parameters:built.records};
 assert.deepEqual(relatedFieldValue(data,{id:'company'},DEFINITIONS.accounts.fields.find(f=>f.key==='invoice_emails')),['billing@company.test','vendor@company.test']);
 const defs=structuredClone(DEFINITIONS);extendSourceFields(defs,built.fields);assert.ok(!defs.accounts.fields.some(f=>f.sourceName==='Invoice email'));
 // Invoice email is Company card only since the 4 Nov 2026 field review, so old layout keys are dropped.
 assert.ok(!tableColumnFields('accounts').some(f=>f.key==='invoice_emails'));
 const pref=restoreView({visibleKeys:[`src__ClickUp:901515197551__${key}`,`src__ClickUp:901515191148__${key}`]},'accounts');
 assert.ok(!pref.visibleKeys.some(k=>k==='invoice_emails'||k.startsWith('src__')),'falls back to the default columns');
});

test('Deal terminology preserves separate sales and delivery relationships',()=>{
 assert.equal(DEFINITIONS.opportunities.singular,'deal');assert.equal(DEFINITIONS.opportunities.plural,'Deals');
 assert.equal(DEFINITIONS.projects.fields.find(f=>f.key==='opportunity_id').label,'Deal');
 const original={id:'one',...DEFINITIONS.opportunities.defaults,name:'Website',account_id:'same-company'};
 assert.deepEqual(recordPatch('opportunities',setField(original,DEFINITIONS.opportunities.fields.find(f=>f.key==='stage'),'Quote sent'),original),{stage:'Quote sent',probability:52});
});

test('Company trading and legal names are editable card facts without new table controls',()=>{
 const company={id:'company',...DEFINITIONS.accounts.defaults,name:'Brand'};
 assert.deepEqual(recordPatch('accounts',{...company,trading_name:'Trading brand',legal_name:'Company s.r.o.'},company),{trading_name:'Trading brand',legal_name:'Company s.r.o.'});
 for(const fields of [tableColumnFields('accounts'),tableFilterFields('accounts'),groupFields('accounts')])assert.ok(!fields.some(f=>['trading_name','legal_name'].includes(f.key)));
});
