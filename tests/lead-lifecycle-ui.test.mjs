import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFINITIONS,LEAD_STATUSES,companyClassificationField,relatedFieldValue,recordPatch,setField,tableColumnFields,tableFilterFields,groupFields} from '../src/workspace-model.ts';

test('Company is the single owner of lead status; Contacts use the linked value across table controls',()=>{
 assert.deepEqual(LEAD_STATUSES,['New','SQL','No Lead']);
 assert.equal(DEFINITIONS.accounts.defaults.lead_status,'New');
 assert.equal(DEFINITIONS.accounts.defaults.lifecycle,null);
 const company={id:'company',...DEFINITIONS.accounts.defaults,name:'Company',lead_status:'SQL',lifecycle:'Prospect'};
 const contact={id:'person',account_id:'company',first_name:'Person'};
 const field=DEFINITIONS.contacts.fields.find(f=>f.key==='company_lead_status');
 assert.deepEqual(field.linked,{table:'accounts',via:'account_id',field:'lead_status'});
 assert.equal(relatedFieldValue({accounts:[company]},contact,field),'SQL');
 assert.equal(relatedFieldValue({accounts:[company]},{...contact,account_id:null},field),'');
 for(const fields of [tableColumnFields,tableFilterFields,groupFields]){
  assert.ok(fields('accounts').some(f=>f.key==='lead_status'));
  assert.ok(fields('contacts').some(f=>f.key==='company_lead_status'));
 }
 assert.ok(!('company_lead_status' in recordPatch('contacts',{...contact,last_name:'Changed'},contact)));
 const leadField=DEFINITIONS.accounts.fields.find(f=>f.key==='lead_status');
 assert.equal(setField(company,leadField,'No Lead').lifecycle,null);
 const customer={...company,has_customer_history:true,lifecycle:'Customer'};
 assert.equal(setField(customer,leadField,'No Lead').lifecycle,'Former customer');
 assert.throws(()=>recordPatch('accounts',setField(customer,leadField,'New'),customer),/Previous customers/);
 const lifecycle=DEFINITIONS.accounts.fields.find(f=>f.key==='lifecycle');
 assert.equal(companyClassificationField(lifecycle,company).readonly,true);
 assert.equal(companyClassificationField(lifecycle,customer).readonly,false);
 assert.deepEqual(companyClassificationField(lifecycle,customer).options,['Customer','Former customer']);
 assert.throws(()=>recordPatch('accounts',{...customer,lifecycle:'Prospect'},customer),/Lifecycle follows/);
});

test('new sales require a Company and Contact while unchanged imported identity gaps remain editable',()=>{
 const original={id:'deal',...DEFINITIONS.opportunities.defaults,name:'Imported',account_id:null,primary_contact_id:null};
 assert.deepEqual(recordPatch('opportunities',{...original,name:'Updated'},original),{name:'Updated'});
 assert.throws(()=>recordPatch('opportunities',original),/Company is required/);
 assert.throws(()=>recordPatch('opportunities',{...original,account_id:'company'}),/Contact is required/);
 assert.throws(()=>recordPatch('opportunities',{...original,stage:'Won'},original),/Company is required/);
 assert.throws(()=>recordPatch('opportunities',{...original,account_id:'company',stage:'Won'},original),/Select a contact/);
});
