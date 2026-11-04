import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceMoney,projectProjection,dealProjection,reconcileFields} from '../record-reconciliation.mjs';

test('unknown contract values remain null while an explicit zero is retained',()=>{
  for(const value of [null,undefined,'',' '])assert.equal(sourceMoney(value),null);
  assert.equal(sourceMoney('0'),0);assert.equal(sourceMoney('9200.50'),9200.5);
  for(const value of ['1,200',-1,'1.001','NaN'])assert.throws(()=>sourceMoney(value));
});
test('incomplete historical projects retain missing fields and explicit user corrections',()=>{
  const raw={name:'Historical project',custom_item_id:1004,custom_fields:[{name:'PROJECT PHASE',value:'08 CLOSED'}]};
  const row=projectProjection(raw);
  assert.equal(row.account_id,null);assert.equal(row.project_group,null);assert.equal(row.contract_value,null);assert.equal(row.status,'Completed');
  assert.equal(projectProjection(raw,{override:{contract_value:'9200',group:'Transformacia'}}).contract_value,9200);
  assert.throws(()=>projectProjection({...raw,parent:'parent'}),/top-level/);
});
test('Sales import retains person-only deals, derives activity dates, and excludes distributor stages',()=>{
  const raw={title:'Person enquiry',pipeline_id:2,stage_id:10,status:'open',currency:'EUR',value:0,next_activity_id:4,custom_fields:{}};
  const row=dealProjection(raw,{contactId:'person',activities:[{id:4,due_date:'2026-11-01',done:false}]});
  assert.equal(row.account_id,null);assert.equal(row.primary_contact_id,'person');assert.equal(row.next_activity,'2026-11-01');assert.equal(row.probability,52);
  assert.throws(()=>dealProjection({...raw,pipeline_id:5}),/Outside/);
  assert.throws(()=>dealProjection({...raw,currency:'USD'}),/Non-EUR/);
});
test('source updates preserve local edits and unrelated custom fields, comparing money numerically',()=>{
  const before={name:'Original',amount:100,custom_fields:{product:['A','B']}};
  const current={...before,name:'Local edit',amount:'100.00',custom_fields:{product:['B','A'],local:'Keep'}};
  const result=reconcileFields(current,before,{name:'Source edit',amount:200,custom_fields:{product:['C']}});
  assert.deepEqual(result.patch,{amount:200,custom_fields:{product:['C'],local:'Keep'}});
  assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].field,'name');
});
