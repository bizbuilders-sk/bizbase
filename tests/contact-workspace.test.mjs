import test from 'node:test';
import assert from 'node:assert/strict';
import {contactFirstTabs, contactProjectIds, relatedEnquiries, workspaceTables} from '../src/entity-presentation.ts';

test('Contacts becomes the initial relationship tab once without resetting later user choices', () => {
  const migrated=contactFirstTabs({'Accounts & contacts':'accounts',Projects:'services'});
  assert.equal(migrated['Accounts & contacts'],'contacts');
  assert.equal(migrated.Projects,'services');
  assert.equal(contactFirstTabs({...migrated,'Accounts & contacts':'duplicates'})['Accounts & contacts'],'duplicates');
  assert.deepEqual(workspaceTables('Pipeline'),['opportunities']);
});

test('contact delivery follows explicit contact/deal links including bundled projects, not every company project', () => {
  const deals=[{id:'mine',primary_contact_id:'person'},{id:'other',primary_contact_id:'colleague'}];
  const projects=[{id:'one',opportunity_id:'mine'},{id:'two',opportunity_id:'mine'},{id:'other',opportunity_id:'other'},{id:'unlinked',account_id:'same-company'},{id:'direct',primary_contact_id:'person'}];
  assert.deepEqual([...contactProjectIds('person',projects,deals)],['one','two','direct']);
});

test('enquiry history retains person-only submissions and respects an explicitly different historical company', () => {
  const contacts=[{id:'person',account_id:'company'}];
  const enquiries=[{id:'direct',account_id:'company'},{id:'person-only',contact_id:'person'},{id:'historical',account_id:'old-company',contact_id:'person'},{id:'unrelated',contact_id:'other'}];
  assert.deepEqual(relatedEnquiries('contacts',{id:'person'},enquiries,contacts).map(row=>row.id),['person-only','historical']);
  assert.deepEqual(relatedEnquiries('accounts',{id:'company'},enquiries,contacts).map(row=>row.id),['direct','person-only']);
});
