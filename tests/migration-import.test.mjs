import test from 'node:test';
import assert from 'node:assert/strict';
import {createMigration} from '../migration.js';
import {ROOT_LISTS} from '../migration-core.mjs';
import {csvToSnapshot} from '../clickup-csv.mjs';
const snapshot=()=>({format:'bizbase.clickup.v1',exported_at:'2026-10-17T13:00:00Z',source_folder:'01 ROOT',source_space:'DELIVERY CONSOLE',record_count:1,expected_record_count:3,type_configs:{},records:[{source_container_id:ROOT_LISTS[2].id,source_container_name:'PROJECTS',record_type:'project',source_record_id:'source1',raw_record:{id:'source1',name:'Example project',list:{id:ROOT_LISTS[2].id},custom_fields:[]}}]});
function harness({failWrite=false}={}) {
  const rows=[],events=[];let writes=0;
  const request=async(path,opts={})=>{
    if(path.startsWith('integration_events')){if(opts.method==='POST'){events.push(JSON.parse(opts.body));return null;}return events.slice(-1);}
    if(opts.method==='POST'){writes++;if(failWrite)throw Error('permission denied');rows.push(...JSON.parse(opts.body));return null;}
    if(path.includes('select=*'))return rows;
    return rows.map(r=>({...r,record_name:r.raw_record.name}));
  };
  const app=createMigration({request,connected:()=>true,render:()=>{},escape:s=>String(s??''),pageHead:()=>'',modal:()=>{},toast:()=>{}});
  const file=data=>({size:200,name:'snapshot.json',text:async()=>JSON.stringify(data)});
  return {app,rows,events,file,writes:()=>writes};
}
test('imports once, verifies rows and persists partial coverage; reimport preserves reviews',async()=>{const h=harness(),data=snapshot();await h.app.importFile(h.file(data));assert.equal(h.rows.length,1);assert.equal(h.rows[0].validation_status,'Needs review');assert.equal(h.events[0].payload.expected_record_count,3);assert.match(h.app.view(),/1 of 3 source records copied/);h.rows[0].validation_status='Verified';h.rows[0].validation_notes='Human review';await h.app.importFile(h.file(data));assert.equal(h.writes(),1);assert.equal(h.rows[0].validation_status,'Verified');assert.equal(h.rows[0].validation_notes,'Human review');assert.match(h.app.view(),/1 already present/);});
test('malformed and out-of-scope snapshots cannot write any records',async()=>{const h=harness(),data=snapshot();data.records[0].source_container_id='other-folder';await h.app.importFile(h.file(data));assert.equal(h.writes(),0);assert.match(h.app.view(),/outside the approved/);});
test('write failure stays visible after the table refresh and never claims completion',async()=>{const h=harness({failWrite:true});await h.app.importFile(h.file(snapshot()));assert.equal(h.rows.length,0);assert.equal(h.events.length,0);assert.match(h.app.view(),/permission denied/);assert.doesNotMatch(h.app.view(),/Snapshot imported/);});
test('CSV completion counts all lists and preserves API records with the same identity',async()=>{
  const h=harness();await h.app.importFile(h.file(snapshot()));
  h.rows[0].validation_status='Verified';
  const repeated=csvToSnapshot('Task ID,Task Name\nsource1,Changed CSV name',ROOT_LISTS[2].id,'projects.csv',3);
  await h.app.importFile(h.file(repeated.snapshot));
  assert.equal(h.rows[0].raw_record.name,'Example project');
  assert.equal(h.rows[0].validation_status,'Verified');
  for(const [listId,id] of [[ROOT_LISTS[0].id,'client1'],[ROOT_LISTS[6].id,'revenue1']]){
    const data=csvToSnapshot(`Task ID,Task Name\n${id},Example`,listId,'export.csv',3);
    await h.app.importFile(h.file(data.snapshot));
  }
  assert.equal(h.rows.length,3);assert.equal(h.events.at(-1).payload.stored_record_count,3);
  assert.equal(h.events.at(-1).payload.expected_record_count,3);
  assert.doesNotMatch(h.app.view(),/still pending against/);
});
