import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFacts,companyCandidates,dealCandidates,amountEquals} from '../crm-reconciliation-core.mjs';
test('company evidence follows source aliases and does not merge conflicting registrations',()=>{
 const data={accounts:[{id:'a',name:'Brand'},{id:'b',name:'Legal s.r.o.',registration_number:'87654321'}],identities:[{entity_type:'account',source_external_id:'ClickUp:clients:1',canonical_id:'a'}],source_accounts:[{system:'ClickUp',container:'clients',source_id:'1',name:'Brand',fields:[{name:'LEGAL NAME',value:'Legal s.r.o.'},{name:'ICO',value:'12345678'}]}]};
 const facts=companyFacts(data);assert.deepEqual(facts[0].legalNames,['Legal s.r.o.']);
 const pairs=companyCandidates(facts);assert.equal(pairs.length,1);assert.equal(pairs[0].conflict,true);
});
test('deal candidates preserve unknown contracts, require a company and exclude already linked delivery',()=>{
 const data={deals:[{id:'one',account_id:'a',stage:'Won',amount:100,name:'Naming'},{id:'missing',account_id:null,stage:'Won',amount:100,name:'Unassigned'}],projects:[{id:'p',account_id:'b',name:'Naming',contract_value:null},{id:'existing',account_id:'a',name:'Other',contract_value:100,opportunity_id:'old'},{id:'unassigned',account_id:null,name:'Unassigned',contract_value:100}]};
 const matches=dealCandidates(data,new Map([['b','a']]));assert.equal(matches[0].matches.length,1);assert.equal(matches[0].matches[0].exactAmount,false);assert.equal(matches[0].matches[0].exactName,true);assert.equal(matches[1].matches.length,0);assert.equal(amountEquals(null,0),false);
});
