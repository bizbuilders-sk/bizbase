import test from 'node:test';
import assert from 'node:assert/strict';
import {companyKey,canMergeCompanies,canMergePeople,preferredCompanyName,preferredPersonName,preferredEmail,safeGroups,retainedValues} from '../contact-reconciliation.mjs';
test('company reconciliation prefers original legal/capitalized names and rejects legal identity conflicts',()=>{
  assert.equal(companyKey('J&R INSPIRE spol.s r.o.'),companyKey('j r inspire'));
  assert.equal(preferredCompanyName(['acme','ACME','Acme s.r.o.']),'Acme s.r.o.');
  assert.equal(canMergeCompanies({name:'Acme'},{name:'ACME s.r.o.'}),true);
  assert.equal(canMergeCompanies({name:'Acme s.r.o.'},{name:'Acme a.s.'}),false);
  assert.equal(canMergeCompanies({name:'Acme',tax_id:'123'},{name:'ACME',tax_id:'456'}),false);
  assert.equal(canMergeCompanies({name:'Acme',website:'acme.sk'},{name:'ACME',website:'other.sk'}),false);
  assert.equal(canMergeCompanies({name:'-'},{name:'-'}),false);
});
test('email preference keeps business-domain addresses ahead of personal mail',()=>{
  assert.equal(preferredEmail(['person@gmail.com','person@acme.sk'],{name:'ACME s.r.o.'}),'person@acme.sk');
  assert.equal(preferredEmail(['person@other.sk','person@acme.sk'],{name:'Brand',website:'https://www.acme.sk'}),'person@acme.sk');
  assert.equal(preferredEmail(['info@acme.sk','person@acme.sk'],{name:'Acme'}),'person@acme.sk');
  assert.equal(preferredEmail(['bad address'] ),null);
  assert.deepEqual(retainedValues([{email:'person@gmail.com'},{email:'person@acme.sk'}],['email']).email,['person@gmail.com','person@acme.sk']);
});
test('contact matching holds shared inboxes, shared phones and unrelated companies apart',()=>{
  const a={first_name:'Jana',last_name:'Nováková',account_id:'a',email:'jana@gmail.com',phone:'+421900123456'};
  assert.equal(canMergePeople(a,{...a,email:'jana@acme.sk',phone:null}),true);
  assert.equal(canMergePeople(a,{...a,first_name:'Peter'}),false);
  assert.equal(canMergePeople(a,{...a,account_id:'b'}),false);
  assert.equal(canMergePeople(a,{...a,account_id:null}),true);
  assert.equal(canMergePeople({...a,email:null},{...a,account_id:null,email:null,phone:null}),false);
  assert.equal(preferredPersonName(['jana novakova','Jana Nováková']),'Jana Nováková');
});
test('duplicate groups require every member to be compatible rather than trusting transitive weak matches',()=>{
  const groups=safeGroups([{id:'a'},{id:'b'},{id:'c'}],(a,b)=>!['ac','ca'].includes(a.id+b.id));
  assert.deepEqual(groups.map(group=>group.map(row=>row.id)),[['a','b'],['c']]);
});
test('known company aliases match without bypassing conflicting legal types',()=>{
  assert.equal(canMergeCompanies({name:'Brand',alternate_names:['Legal Company s.r.o.']},{name:'Legal Company'}),true);
  assert.equal(canMergeCompanies({name:'Brand s.r.o.',alternate_names:['Brand']},{name:'Brand a.s.',alternate_names:['Brand']}),false);
});
test('phone corroboration handles partial first names and repeated surname data without merging different people',()=>{
  const person={first_name:'Alexander',last_name:'Uj',account_id:'a',phone:'+421900123456'};
  assert.equal(canMergePeople(person,{...person,first_name:'Alexander Uj',last_name:'Uj'}),true);
  assert.equal(canMergePeople(person,{...person,last_name:null}),true);
  assert.equal(canMergePeople(person,{...person,first_name:'Peter'}),false);
  assert.equal(preferredPersonName(['Alexander Uj Uj','Alexander Uj']),'Alexander Uj');
});
