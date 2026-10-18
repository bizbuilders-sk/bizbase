import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,csvToSnapshot} from '../clickup-csv.mjs';
import {stagingRow,ROOT_LISTS,displayField} from '../migration-core.mjs';
const revenue=ROOT_LISTS.find(l=>l.name==='REVENUE');
test('reads UTF-8 BOM, CRLF, escaped quotes, quoted commas and multiline descriptions',()=>{
  const data='\uFEFFTask ID,Task Name,Description,Code\r\na1,"Company, s.r.o.","Line one\nLine ""two""",0012\r\n';
  const csv=parseCsv(data);assert.equal(csv.delimiter,',');assert.deepEqual(csv.rows,[['a1','Company, s.r.o.','Line one\nLine "two"','0012']]);
});
test('handles semicolon and tab-delimited exports without converting financial formats',()=>{
  const csv='Task ID;Task Name;TOTAL PRICE (currency);Invoice ID\na1;Žltý projekt;1.234,56 €;000123\n';
  const {snapshot}=csvToSnapshot(csv,revenue.id);const raw=snapshot.records[0].raw_record;
  assert.equal(raw.custom_fields[0].name,'TOTAL PRICE');assert.equal(displayField(raw.custom_fields[0]),'1.234,56 €');assert.equal(raw.custom_fields[1].value,'000123');
  assert.deepEqual(parseCsv('Task ID\tTask Name\na1\tExample').rows,[['a1','Example']]);
});
test('preserves every header/cell, formula text and duplicate custom headers without interpretation',()=>{
  const csv='Task ID,Task Name,Email,Email,Formula\na1,Example,first@example.test,second@example.test,=1+1';
  const {snapshot}=csvToSnapshot(csv,revenue.id);const raw=snapshot.records[0].raw_record;
  assert.deepEqual(raw._csv.headers,['Task ID','Task Name','Email','Email','Formula']);assert.equal(raw._csv.cells[4],'=1+1');assert.equal(raw.custom_fields.length,3);assert.notEqual(raw.custom_fields[0].id,raw.custom_fields[1].id);
});
test('rejects wrong lists/folders, blank IDs and ambiguous core columns',()=>{
  assert.throws(()=>csvToSnapshot('Task ID,Task Name,List\na1,Example,PROJECTS',revenue.id),/not REVENUE/);
  assert.throws(()=>csvToSnapshot('Task ID,Task Name,Folder\na1,Example,02 PROJECTS',revenue.id),/outside/);
  assert.throws(()=>csvToSnapshot('Task ID,Task Name\n,Example',revenue.id),/Task ID/);
  assert.throws(()=>csvToSnapshot('Task ID,task_id,Task Name\na1,a1,Example',revenue.id),/ambiguous/);
});
test('collapses identical repeated tasks but rejects conflicting duplicate task IDs',()=>{
  const csv='Task ID,Task Name,Status\na1,Example,paid\na1,Example,paid';
  const result=csvToSnapshot(csv,revenue.id);assert.equal(result.duplicates,1);assert.equal(result.snapshot.record_count,1);
  assert.throws(()=>csvToSnapshot(csv+'\na1,Example,unpaid',revenue.id),/different values/);
});
test('rejects malformed quoting or mismatched rows before creating a snapshot',()=>{
  assert.throws(()=>parseCsv('Task ID,Task Name\na1,"Unclosed'),/unclosed/);
  assert.throws(()=>parseCsv('Task ID,Task Name\na1,Too,many'),/cells/);
  assert.throws(()=>parseCsv('Task ID,Task Name\na1,"Quoted"extra'),/Unexpected/);
});
test('CSV and API records share stable identity, ISO source date, and review-only staging',async()=>{
  const csv='Task ID,Task Name,Date Updated,List,Folder\nhttps://app.clickup.com/t/a1,Example,2026-10-17T13:00:00Z,REVENUE,01 ROOT';
  const {snapshot}=csvToSnapshot(csv,revenue.id,'REVENUE.csv',2552);
  const row=await stagingRow(snapshot.records[0],snapshot);
  assert.equal(row.source_record_id,'a1');assert.equal(row.source_updated_at,'2026-10-17T13:00:00.000Z');assert.equal(row.validation_status,'Needs review');assert.match(row.validation_notes,/relationship names/);assert.equal(snapshot.expected_record_count,2552);
});
