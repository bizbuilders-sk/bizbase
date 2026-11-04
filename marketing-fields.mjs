import {displayField} from './migration-core.mjs';

export const FOLLOW_UP_STEPS = ['Ideme osloviť','MB rieši','DC naplánovaný','Neoslovujeme','Nemajú záujem o DC','DC prebehol','už spolupracujeme','PL rieši','Príprava ponuky','Nereaguje/Bez odpovede','Nejdeme osloviť','Už je v procese','Reopen'];
export const MARKETING_FIELD_SPECS = [
  {key:'follow_up_notes',label:'Next step notes',names:['Next step (Poznámky)'],type:'textarea'},
  {key:'dc_notes',label:'DC note',names:['Poznamka k DC','info k DC'],type:'textarea'},
  {key:'source_notes',label:'Marketing notes',names:['Notes'],type:'textarea'},
  {key:'first_email_sent',label:'First email sent',names:['poslany 1.mail'],type:'boolean'},
  {key:'audit_requested',label:'Free audit requested',names:['Záujem o vypracovanie auditu zdarma?'],type:'boolean'},
  {key:'consultation_requested',label:'Consultation requested',names:['KONZULTÁCIA','FREE KONZULTACIA'],type:'boolean'},
  {key:'heard_about',label:'How they heard about us',names:['Kde ste sa dozvedeli'],type:'select',options:['Web','LinkedIn','Instagram','Facebook','Youtube','Google','AI nástroje','Newsletter ProfitBuilder','Podcast 24 hodín na úspech','Odporúčanie od známeno / kolegu','Iný webinár alebo event BizB','Partner / spolupracujúca firma','Iné']},
  {key:'offering',label:'What they sell and to whom',names:['Čo predávate a komu'],type:'textarea'},
  {key:'competitors',label:'Main competitors',names:['1-3 hlavní konkurenti'],type:'textarea'},
  {key:'audit_brand',label:'Brand to audit',names:['Akú značku chcete auditovať?'],type:'text'},
  {key:'takeaway_goal',label:'Expected takeaway',names:['chcem si odniest'],type:'textarea'},
  {key:'learned',label:'Feedback / learning',names:['dozvedel som sa'],type:'textarea'},
  {key:'interest',label:'Reported interest',names:['INTEREST'],type:'text'},
  {key:'contact_notes',label:'Contact notes',names:['Kontakt poznámky'],type:'textarea'},
  {key:'client_comment',label:'Client comment',names:['Komentar klienta'],type:'textarea'},
  {key:'competition_entered',label:'Competition entered',names:['SÚŤAŽ'],type:'boolean'},
  {key:'full_report_requested',label:'Full report requested',names:['FULL REPORT'],type:'boolean'},
  {key:'source_detail',label:'Source detail',names:['SOURCE'],type:'text'},
  {key:'reported_website',label:'Reported website',names:['Website'],type:'text'},
  {key:'registration_number',label:'Reported company registration no.',names:['ICO'],type:'text'},
  {key:'address',label:'Reported address',names:['ADDRESS'],type:'textarea'},
  {key:'quantity',label:'Source quantity',names:['QUANTITY'],type:'number'},
  {key:'source_total_price',label:'Source total price · EUR',names:['TOTAL PRICE'],type:'number'},
  {key:'source_item_price',label:'Source item price · EUR',names:['ITEM PRICE'],type:'number'},
  {key:'source_month',label:'Source month',names:['MONTH'],type:'text'},
  {key:'lead_form',label:'Lead form',names:['LEAD FORM'],type:'select',options:['BIZTALK','EBOOK']},
];
const normalized=value=>String(value).toLocaleLowerCase().trim();
export function populatedSourceField(raw,name) {
  const candidates=(raw.custom_fields||[]).filter(field=>normalized(field.name)===normalized(name));
  return candidates.find(field=>field.value!==null&&field.value!==undefined&&field.value!=='')||candidates[0];
}
export function extractMarketingFields(raw) {
  const fields=raw.custom_fields||[],marketing_fields={},conflicts={};
  const next=fields.filter(field=>normalized(field.name)==='next step').map(displayField).filter(Boolean);
  const steps=[...new Set(next)];
  if(steps.length>1)conflicts.follow_up=steps;
  for(const spec of MARKETING_FIELD_SPECS) {
    const source=spec.names.flatMap(name=>fields.filter(field=>normalized(field.name)===normalized(name)));
    if(!source.length)continue;
    if(spec.type==='boolean')marketing_fields[spec.key]=source.some(field=>field.value===true||field.value==='true');
    else {
      const values=[...new Set(source.map(displayField).filter(Boolean))];
      if(spec.type==='number')marketing_fields[spec.key]=values.length===1&&Number.isFinite(Number(values[0]))?Number(values[0]):null;
      else marketing_fields[spec.key]=values.join('\n')||null;
    }
  }
  if(Object.keys(conflicts).length)marketing_fields.source_conflicts=conflicts;
  return {follow_up:steps.length===1?steps[0]:null,marketing_fields};
}
