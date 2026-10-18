import test from 'node:test';
import assert from 'node:assert/strict';
import {findDuplicateCandidates} from '../duplicates-core.mjs';

test('flags company name and website matches with normalized text',()=>{
  const rows=findDuplicateCandidates([
    {id:'a',name:'Žltá Firma, s.r.o.',website:'https://example.test/'},
    {id:'b',name:'Zlta Firma sro',website:'example.test'},
    {id:'c',name:'Different Company'}
  ]);
  assert.equal(rows.length,1);assert.equal(rows[0].type,'account');assert.equal(rows[0].score,100);
  assert.deepEqual(rows[0].reasons,['Same website','Same company name']);
});

test('flags high-confidence contact duplicates inside the same company',()=>{
  const rows=findDuplicateCandidates([], [
    {id:'c1',account_id:'a1',first_name:'Mira',last_name:'Kovac',email:'Mira@example.test',phone:'+421 900 111 222'},
    {id:'c2',account_id:'a1',first_name:'Mira',last_name:'Kováč',email:' mira@example.test ',phone:'00421900111222'},
    {id:'c3',account_id:'a1',first_name:'Alex',last_name:'Roe',email:'alex@example.test'}
  ]);
  assert.equal(rows.length,1);assert.equal(rows[0].score,100);assert.ok(rows[0].reasons.includes('Same email address'));
});

test('does not suggest a contact merge from a shared name across different companies',()=>{
  const rows=findDuplicateCandidates([], [
    {id:'c1',account_id:'a1',first_name:'Alex',last_name:'Smith'},
    {id:'c2',account_id:'a2',first_name:'Alex',last_name:'Smith'}
  ]);
  assert.deepEqual(rows,[]);
});

test('does not treat two blank contact fields or loosely similar company names as duplicates',()=>{
  const rows=findDuplicateCandidates(
    [{id:'a1',name:'North Star'}, {id:'a2',name:'Northstar Logistics'}],
    [{id:'c1',account_id:'a1',first_name:'',last_name:'',email:'',phone:''},{id:'c2',account_id:'a1',first_name:'',last_name:'',email:'',phone:''}]
  );
  assert.deepEqual(rows,[]);
});
