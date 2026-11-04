import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFINITIONS,LAYOUT_VERSION,cardSections,restoreView,tableColumnFields} from '../src/workspace-model.ts';
import {CARD_LAYOUT,TABLE_CONTROLS} from '../src/table-field-policy.ts';

const main=['contacts','accounts','opportunities','projects'];

test('lists inside a record card always show the full history, while the main Deals screen defaults to Open',()=>{
  const saved={filter:'Open',filters:[{id:'won',field:'stage',operator:'eq',value:'Won'}],sortKey:'amount'};
  const card=restoreView(saved,'opportunities',{},'primary_contact_id');
  assert.equal(card.filter,'All');assert.deepEqual(card.filters,[]);assert.equal(card.sortKey,'amount','columns and sorting still restore');
  assert.equal(restoreView(null,'opportunities',{},'account_id').filter,'All');
  assert.equal(restoreView(null,'opportunities').filter,'Open');
  assert.equal(restoreView({filter:'Won'},'opportunities').filter,'Won','main screens keep their saved quick filter');
});

test('default columns come first, stay compact and exist in the column catalogue',()=>{
  for(const table of main){
    const {visible,columns}=TABLE_CONTROLS[table];
    assert.ok(visible&&visible.length<=8,`${table}: at most 8 default columns`);
    assert.deepEqual(columns.slice(0,visible.length),visible,`${table}: defaults lead the column order`);
    const fresh=restoreView(null,table);
    assert.deepEqual(fresh.visibleKeys,visible);assert.deepEqual(fresh.columnOrder.slice(0,visible.length),visible);
  }
  assert.ok(!TABLE_CONTROLS.opportunities.visible.includes('probability'),'probability follows the stage');
  assert.deepEqual(TABLE_CONTROLS.opportunities.visible.slice(0,4),['name','account_id','primary_contact_id','stage']);
});

test('layouts saved before the current version get the new default columns once; filters and sorting survive',()=>{
  const keys=tableColumnFields('projects').map(f=>f.key);
  const old={knownKeys:keys,visibleKeys:['added_on','name'],columnOrder:['added_on','name',...keys],sortKey:'end_date',filters:[{id:'mine',field:'owner_id',operator:'not_empty',value:''}],filter:'All'};
  const migrated=restoreView(old,'projects');
  assert.deepEqual(migrated.visibleKeys,TABLE_CONTROLS.projects.visible);
  assert.equal(migrated.columnOrder[0],'name');assert.equal(migrated.sortKey,'end_date');assert.deepEqual(migrated.filters.map(f=>f.id),['mine']);
  assert.equal(migrated.layoutVersion,LAYOUT_VERSION);
  const customised=restoreView({...migrated,visibleKeys:['name','added_on']},'projects');
  assert.deepEqual(customised.visibleKeys,['name','added_on'],'a current-version layout is not reset again');
});

test('record cards put key fields first and never drop a field the card shows',()=>{
  for(const [table,layout] of Object.entries(CARD_LAYOUT)){
    const defined=new Set(DEFINITIONS[table].fields.map(f=>f.key));
    for(const section of layout)for(const key of section.keys)assert.ok(defined.has(key),`${table}.${section.title}: undefined ${key}`);
  }
  const fields=DEFINITIONS.opportunities.fields;
  const open=cardSections('opportunities',fields,{stage:'Start'});
  assert.equal(open[0].title,'Deal');assert.deepEqual(open[0].fields.slice(0,3).map(f=>f.key),['name','stage','amount']);
  assert.ok(!open.flatMap(s=>s.fields).some(f=>f.key==='lost_reason'),'lost reason only for lost deals');
  assert.ok(cardSections('opportunities',fields,{stage:'Lost'})[0].fields.some(f=>f.key==='lost_reason'));
  const shown=fields.filter(f=>f.key!=='lost_reason');
  assert.equal(open.flatMap(s=>s.fields).length,shown.length,'every field appears exactly once');
  assert.ok(open.find(s=>s.title==='Imported & system').collapsed);
  const project=cardSections('projects',DEFINITIONS.projects.fields,{data_quality_status:''});
  const system=project.find(s=>s.title==='Imported & system');
  assert.ok(system.collapsed&&system.open,'a collapsed section with an empty required field opens');
  assert.ok(!cardSections('projects',DEFINITIONS.projects.fields,{data_quality_status:'Needs review'}).find(s=>s.title==='Imported & system').open);
  assert.deepEqual(cardSections('services',DEFINITIONS.services.fields,{}).map(s=>s.title),['Details'],'tables without a layout keep one section');
});

test('every field the main record cards show has a named section',()=>{
  for(const [table,layout] of Object.entries(CARD_LAYOUT)){
    const listed=new Set(layout.flatMap(s=>s.keys));
    const card=DEFINITIONS[table].fields.filter(f=>!(table==='contacts'&&f.linked?.table==='accounts')&&!f.sourceParameter&&!(f.readonly&&f.container==='custom_fields')&&f.key!=='source'&&!['contacts_count','planned_revenue','planned_cost','participant_count'].includes(f.key)&&!f.registrationScope);
    assert.deepEqual(card.filter(f=>!listed.has(f.key)).map(f=>f.key),[],`${table}: fields fall through to Other details`);
  }
});
