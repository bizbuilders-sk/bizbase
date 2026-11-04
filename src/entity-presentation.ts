export type EntityColor = 'contacts' | 'deals' | 'projects' | 'neutral';

export function pageTitle(page: string) {
  return page === 'Accounts & contacts' ? 'Contacts' : page === 'Pipeline' ? 'Deals' : page;
}
export function pageEntity(page: string): EntityColor {
  return page === 'Accounts & contacts' ? 'contacts' : page === 'Pipeline' ? 'deals' : page === 'Projects' ? 'projects' : 'neutral';
}
export function tableEntity(table: string): EntityColor {
  if (['projects', 'project_services', 'vendor_costs', 'services'].includes(table)) return 'projects';
  if (['opportunities', 'opportunity_services'].includes(table)) return 'deals';
  if (['accounts', 'contacts', 'intake_leads', 'events', 'event_participations'].includes(table)) return 'contacts';
  return 'neutral';
}
export function workspaceTables(page: string) {
  return page === 'Pipeline' ? ['opportunities'] : page === 'Projects' ? ['projects', 'services'] : ['contacts', 'accounts', 'duplicates'];
}
// Switch the relationship screen to Contacts once; subsequent explicit tab choices persist.
export function contactFirstTabs(saved: Record<string, string>) {
  return saved.__contactFirst === '1' ? saved : {...saved, 'Accounts & contacts': 'contacts', __contactFirst: '1'};
}
type RelatedRow = {id: string; [key: string]: unknown};
export function contactProjectIds(contactId: string, projects: RelatedRow[], deals: RelatedRow[]) {
  const dealIds = new Set(deals.filter(deal => deal.primary_contact_id === contactId).map(deal => deal.id));
  return new Set(projects.filter(project => project.primary_contact_id === contactId || dealIds.has(String(project.opportunity_id || ''))).map(project => project.id));
}
export function relatedEnquiries(table: string, row: RelatedRow, leads: RelatedRow[], contacts: RelatedRow[]) {
  if (table === 'contacts') return leads.filter(lead => lead.contact_id === row.id);
  if (table !== 'accounts') return [];
  const people = new Set(contacts.filter(contact => contact.account_id === row.id).map(contact => contact.id));
  return leads.filter(lead => lead.account_id === row.id || !lead.account_id && people.has(String(lead.contact_id || '')));
}
