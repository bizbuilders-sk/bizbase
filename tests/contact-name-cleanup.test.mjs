import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPersonName,inferEmailName,planContactNameCleanup} from '../contact-name-cleanup.mjs';

test('full names split without losing Slovak accents or compound surnames',()=>{
 assert.deepEqual(splitPersonName('Martin Ďurík'),{first_name:'Martin',last_name:'Ďurík'});
 assert.deepEqual(splitPersonName('Daša Čierna Hrušková'),{first_name:'Daša',last_name:'Čierna Hrušková'});
 assert.deepEqual(splitPersonName('Katarina Novak Hruskova'),{first_name:'Katarina',last_name:'Novak Hruskova'});
 assert.deepEqual(splitPersonName('J.Horák'),{first_name:'J.',last_name:'Horák'});
});
test('honorifics are retained and role/company tails do not become surnames',()=>{
 assert.deepEqual(splitPersonName('Ing. Gabriela Mrazova Owner, ACMESOL s.r.o.'),{first_name:'Ing. Gabriela',last_name:'Mrazova'});
 assert.deepEqual(splitPersonName('Zuzana Bielikova - Director / Co-Founder NORTHWARD'),{first_name:'Zuzana',last_name:'Bielikova'});
 assert.equal(splitPersonName('FULL REPORT — EXAMPLIO s.r.o.'),null);
 assert.equal(splitPersonName('4M Group'),null);
});
test('personal emails support separated, reversed and joined names without inventing accents',()=>{
 assert.deepEqual(inferEmailName('veronikahruskova@example.test'),{first_name:'Veronika',last_name:'Hruskova'});
 assert.deepEqual(inferEmailName('kornelbartos@example.test'),{first_name:'Kornel',last_name:'Bartos'});
 assert.deepEqual(inferEmailName('kmet.juraj@example.test'),{first_name:'Juraj',last_name:'Kmet'});
 assert.deepEqual(inferEmailName('m.kral@example.test'),{first_name:'M.',last_name:'Kral'});
 assert.deepEqual(inferEmailName('k.farkas@example.test','Katarína'),{first_name:'Katarína',last_name:'Farkas'});
 assert.deepEqual(inferEmailName('jan@example.test'),{first_name:'Jan',last_name:null});
});
test('generic mailboxes and ambiguous handles never turn into a person',()=>{
 for(const e of ['info@example.test','marketing@example.test','hello@acmeconsult.test','acmetherm@acmetherm.test','zeto2252@example.test','anna.jazykovedko@example.test','mystery_xy@example.test'])assert.equal(inferEmailName(e),null,e);
});
test('generational suffixes remain attached to the surname rather than replacing it',()=>{
 const plan=planContactNameCleanup([{id:'one',first_name:'Marián Hudák',last_name:'ml.',email:'person@example.test'}]);
 assert.deepEqual(plan.patches[0].after,{first_name:'Marián',last_name:'Hudák ml.',email:'person@example.test'});
});
test('repairs preserve original fields, verified source accents and unrelated complete contacts',()=>{
 const rows=[{id:'a',account_id:'company',first_name:'Ján Petrík',last_name:null,email:'jan@example.test'},
 {id:'b',first_name:null,last_name:null,email:'veronikahruskova@example.test'},
 {id:'c',account_id:'company',first_name:'kornelbartos@example.test',last_name:null,email:null},
 {id:'d',first_name:'Martin',last_name:'Existing',email:'other.person@example.test'},
 {id:'e',first_name:'Michal',last_name:null,email:'michal@example.test'}];
 const before=structuredClone(rows);
 const plan=planContactNameCleanup(rows,[{canonical_id:'e',first_name:'Michal',last_name:'Ďurica'}]);
 assert.equal(plan.patches.length,4);
 assert.equal(plan.patches.find(p=>p.id==='c').after.email,'kornelbartos@example.test');
 assert.equal(plan.patches.find(p=>p.id==='e').after.last_name,'Ďurica');
 assert.deepEqual(rows,before);
 assert.ok(!plan.patches.some(p=>p.id==='d'));
 const repaired=rows.map(c=>({...c,...plan.patches.find(p=>p.id===c.id)?.after}));
 assert.equal(planContactNameCleanup(repaired).patches.length,0,'repeating cleanup is harmless');
});
test('conflicting names sharing an email remain for review; known names are never replaced by a different person',()=>{
 const contacts=[{id:'a',first_name:'Peter',last_name:null,email:'peter@example.test'},
 {id:'b',first_name:null,last_name:null,email:'shared@example.test'}];
 const sources=[{canonical_id:'a',first_name:'Roman',last_name:'Other'},
 {canonical_id:'b',first_name:'Jana',last_name:'First'},{canonical_id:'b',first_name:'Eva',last_name:'Second'}];
 assert.equal(planContactNameCleanup(contacts,sources).patches.length,0);
});
