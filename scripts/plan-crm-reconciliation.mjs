import fs from 'node:fs';
import {companyFacts,dealCandidates,amountEquals} from '../crm-reconciliation-core.mjs';
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),facts=companyFacts(d),byId=new Map(facts.map(a=>[a.id,a]));
const named=name=>{const a=facts.filter(a=>a.name===name);if(a.length!==1)throw Error('Ambiguous company '+name);return a[0];};
// Individually reviewed source-name, original client relation, commercial scope,
// contact and amount evidence. Similarity alone never authorizes a merge.
const decisions=[
 ['AREOS real estate','AREOS','Original AREOS client relation; unique AREOS strategy project and Won EUR 11,800 sale.'],
 ['BIO nákupy s.r.o.','DOBRIO','Source sale and project both explicitly name DOBRIO / BIO NAKUPY; EUR 3,500.'],
 ['Edis vvd','EDIS','Identical original Edis CFO review title and EUR 650; EDIS client relation.'],
 ['Orfanus/EOS','ORFANUS','Original Orfanus alias in sales company and sole ORFANUS delivery; EUR 4,600.'],
 ['Centesy','Centesy/Michal Palenik','Exact original Centesy/Michal Palenik sale/project title, EUR 2,000; CENTESY client.'],
 ['JKralo, s. r. o.','Lestero','Original ClickUp client explicitly names KRALOVANSKY / JKRALO / LESTERO; matching web/naming sales.'],
 ['JKralo, s. r. o.','Jakub Kraľovanský','Original KRALOVANSKY / JKRALO / LESTERO client and named Jakub Kralovansky contact.'],
 ['Mgr. Iveta Škodová','Natinuel slovensko','Same Iveta Skodova contact, exact business email and phone; original Natinuel/LUVI sale.'],
 ['prosman&pavlovic','prosman','Original project explicitly names Prosman&Pavlovic; single corresponding client. Quote/contract difference retained.'],
 ['SYNAPSIS, s.r.o.','Synapsis/Knizkova dolina','Original client SYNAPSIS and KNIZKOVA DOLINA (Synapsis) project; sales account explicitly names both.'],
 ['Braffis s.r.o.','FRANK ZICHER','Original FRANK ZICHER / BRAFFIS client alias and same Juraj Opalka business email.'],
 ['DUPLEX s.r.o.','Shifra','Original DUPLEX/SHIFRA client and project, same Roman Palidrab contact.'],
 ['avin s. r. o.','brykon','Original AVIN / BRYKON client alias and multiple projects explicitly naming both.'],
 ['Moore BDR s. r. o.','MOORE BDR / LEXUM','Original client names MOORE BDR / LEXUM; Lexum consultations explicitly for MOORE BDR.'],
 ['DULCIA natural, s. r. o.','DULCIA','Original DULCIA client brand and unique DULCIA strategy; legal name DULCIA natural.'],
 ['Cardoso s. r. o.','Kučeravé','Original KUCERAVE.sk client brand and financial reporting project; Cardoso legal identity.'],
 ['Cardoso s. r. o.','Kučeravé & Curliculum','Same Kucerave brand, Carolina Cardoso contact and cardoso.sk email corroborate the original Cardoso/KUCERAVE client.'],
 ['HAVEL & PARTNERS, advokátska kancelária','havel&partners','Full original law-firm name, unique HAVEL PARTNERS brand and havelpartners.sk contact domain.'],
 ['NEW VELO (VELOCITY)','PROCYCLING/VELOCITY','Original accounts explicitly share VELOCITY brand and original Velocity strategy client.'],
 ['PACKY ADVERTISING','Packy advert','Unique PACKY advertising agency, original vendor contact packy.sk, sales source advertising name. Roles retained.'],
 ['TRIUM REAL','Peter Melník','Original completed Identita pre PETER MELNIK has explicit TRIUM REAL client relation; unique Peter Melnik EUR 9,000 sale.'],
 ['ReSOFT s.r.o.','REfis','Original REFIS delivery explicitly belongs to RESOFT client. EUR 3,500 quote vs EUR 3,400 contract retained.'],
];
const merges=decisions.map(([keep,remove,reason])=>{const a=named(keep),b=named(remove);if(a.taxIds.length>1||b.taxIds.length>1||a.taxIds.length&&b.taxIds.length&&!a.taxIds.some(k=>b.taxIds.includes(k)))throw Error('Legal identity conflict '+keep);return {survivor:a.id,duplicate:b.id,survivor_name:a.name,duplicate_name:b.name,reason};});
const canonical=new Map(merges.map(m=>[m.duplicate,m.survivor]));
const patches=[];const factIssues=[];
for(const a of facts){const patch={};if(!a.legal_name&&a.legalNames.length===1)patch.legal_name=a.legalNames[0];if(!a.registration_number&&a.taxIds.length===1)patch.registration_number=a.taxIds[0];if(!a.address&&a.addresses.length===1)patch.address=a.addresses[0];
 const brands=[...new Set(a.sources.filter(s=>s.system==='ClickUp'&&s.container_name==='CLIENTS').map(s=>s.name).filter(s=>s&&s!==a.legalNames[0]))];
 if(!a.trading_name&&brands.length===1)patch.trading_name=brands[0];
 if(Object.keys(patch).length)patches.push({id:a.id,name:a.name,before:Object.fromEntries(Object.keys(patch).map(k=>[k,a[k]??null])),patch});
 if(a.legalNames.length>1||a.taxIds.length>1||a.addresses.length>1)factIssues.push({id:a.id,name:a.name,legalNames:a.legalNames,taxIds:a.taxIds,addresses:a.addresses});
}
const links=[],used=new Set(d.projects.filter(p=>p.opportunity_id).map(p=>p.id));
const add=(o,p,reason)=>{if(used.has(p.id))throw Error('Project already assigned '+p.name);const saleCompany=canonical.get(o.account_id)||o.account_id||(o.name==='GALVEX investor prospect lead'?named('GALVEX, spol. s r.o.').id:null);const crossCompany=saleCompany!==(canonical.get(p.account_id)||p.account_id);if(crossCompany&&!(o.name==='Drienova 33, Parkovaci dom'&&p.name===o.name&&amountEquals(o.amount,p.contract_value)))throw Error('Company mismatch');used.add(p.id);links.push({project:p.id,deal:o.id,project_name:p.name,deal_name:o.name,reason,crossCompany,project_value:p.contract_value,deal_value:o.amount,variance_eur:p.contract_value===null?null:Number(o.amount)-Number(p.contract_value),before_project:p,before_deal:o});};
let candidates=dealCandidates(d,canonical);
for(const o of candidates){if(o.existingProjects.length)continue;const exact=o.matches.filter(p=>p.exactName&&!used.has(p.id));if(exact.length===1)add(d.deals.find(z=>z.id===o.id),d.projects.find(z=>z.id===exact[0].id),'Same consolidated company and exact original sale/delivery title.');}
for(const o of candidates){if(o.existingProjects.length||links.some(l=>l.deal===o.id))continue;const exact=o.matches.filter(p=>p.exactAmount&&!used.has(p.id));if(exact.length!==1)continue;const competition=candidates.filter(other=>other.id!==o.id&&!other.existingProjects.length&&!links.some(l=>l.deal===other.id)&&other.matches.some(p=>p.id===exact[0].id&&p.exactAmount));if(competition.length)continue;add(d.deals.find(z=>z.id===o.id),d.projects.find(z=>z.id===exact[0].id),'Same consolidated company and unique reciprocal exact EUR amount; original scope reviewed.');}
const explicit=[
 ['AZ PROPERTY stratégia','Strategia pre AZ PROPERTY','Explicit strategy scope; source contract amount remains unknown.'],
 ['Follow-up CLEVERSOFT Logo + web','Web pre CLEVERSOFT','Explicit bundled logo + web sale; two existing scope projects.'],
 ['Follow-up CLEVERSOFT Logo + web','Logo pre CLEVERSOFT','Explicit bundled logo + web sale; aggregate contract variance retained.'],
 ['Done Deal (Earrings)','sent from Piepdrive: Done Deal (Earrings)','Explicit original sent-from-Pipedrive deal title; EUR 20 variance retained.'],
 ['FixDistribution (SBA)','Strategia pre FIXIS (cez SBA)','Original SBA-funded strategy scope distinguishes this from the separate sales strategy.'],
 ['GentleJam deal','WS pre Gentlejam','One Won sale and one existing original delivery for this company. Source amount remains unknown.'],
 ['HB Cleaning SK deal','Brand a naming pre HB Cleaning','One Won sale and one existing original delivery for this company. Source amount remains unknown.'],
 ['Stratégia FULL','Stratégia pre Hofitech/Cyrkalogy','Explicit strategy scope within the same HOFITECH company.'],
 ['Marpex (SBA)','Stratégia pre Marpex (SBA)','Original company and SBA scope; EUR 200 variance retained.'],
 ['Natinuel/LUVI deal','Stratégia pre LUVI STUDIO','Corroborated LUVI/Natinuel company/contact identity and sole original delivery.'],
 ['OPIUM systems deal','Strategia pre OPIUM SYSTEMS','One Won sale and one existing original delivery for OPIUM; variance retained.'],
 ['Purgina - nastavenie obchodu & Value Propo','Nastavenie obchodu pre Purgina','Explicit sales-setup scope; separate web project is not the same scope.'],
 ['SOMAT Group (SBA)','Stratégia pre SOMAT GROUP (SBA)','Same company and explicit SBA strategy scope; EUR 200 variance retained.'],
 ['Synapsis stratégia','Stratégia pre SYNAPSIS','Explicit strategy scope; no invented missing contract amount.'],
 ['Stavebná firma - QBR','QBR pre Avin','Explicit QBR scope within the original AVIN company.'],
 ['freevision deal','Solution sprint pre Freevision','One Won sale and one existing original delivery for Freevision; contract remains unknown.'],
 ['Stratégia','Stratégia pre WEIT','Same WEIT company and explicit strategy scope; contract remains unknown.'],
 ['Jakub Kraľovanský deal','VP a Identita pre KRALOVANSKY','Original KRALOVANSKY client identity and first branding scope; later naming/web are separately sold.'],
 ['prosman&pavlovic','Prosman&Pavlovic - pozicioning','Unique corresponding original company/scope; EUR 3,000 variance explicitly retained for review.'],
 ['REfis deal','VP a akvizičná stratégia pre REFIS','Original REFIS scope and RESOFT client identity; EUR 100 variance retained.'],
 ['Bedeur','Strategia pre Bedeur','Original sale product explicitly MARKETINGOVA STRATEGIA; unique strategy project. EUR 4,700 variance retained.'],
 ['KARTEX - VL lead','Nastavenie obchodu pre KARTEX-VL','Original sale product NASTAVENIE OBCHODU; delivery starts on the source Won date, 2025-09-01. EUR 4,000 variance retained.'],
 ['Sectec','Sectec - prieskum trhu','Sole corresponding company delivery starts on the source Won date, 2026-09-02. EUR 14,000 variance retained.'],
 ['Follow-up po stratégii 2. fáza Identita','Identita pre SYNAPSIS','Explicit phase-2 identity scope and exact EUR 7,500; phase 1 is held separately.'],
 ['Follow-up Synapsis','Pozicioning a logo pre KNIZKOVA DOLINA (Synapsis)','Original sales account explicitly Knizkova dolina/Synapsis; project starts on the source Won date, 2025-11-03. Variance retained.'],
 ['Drienova 33, Parkovaci dom','Drienova 33, Parkovaci dom','Exact original title and EUR 9,800, project start equals Won date 2026-09-21; three explicitly linked revenue instalments sum EUR 9,800. Original SYNAPSIS sales company and DRIENOVA 33 delivery company retained separately.'],
 ['GALVEX investor prospect lead','Prezka pre Galvex','Two original EUR 750 revenue entries explicitly link to Sales prezentacia projektu Senior house / Prezka pre Galvex, June-July 2025; Won June 2025. Missing contract remains NULL.'],
 ['LEDGER follow-up ponuka pre myPortal','BB2GO Q4-Q1 2026 pre LEDGER','MYPORTAL original revenue explicitly links to BB2GO, Oct-Dec 2025 and Jan 2026; delivery starts seven days after Won. Other strategy/QBR billings date to 2024/2023. Quote/contract variance retained.'],
 ['Firmaren follow up','Rekalibrácia pre FIRMAREN','Source implementation revenue explicitly assigned to Rekalibracia begins May 2025, the Won month. Earlier strategy billed 2024/Jan 2025, automation starts billing June 2026. Original quote/contract variance retained for review.'],
];
for(const [dealName,projectName,reason] of explicit){const os=d.deals.filter(o=>o.name===dealName&&o.stage==='Won'),ps=d.projects.filter(p=>p.name===projectName);if(os.length!==1||ps.length!==1)throw Error('Ambiguous explicit scope '+dealName);if(links.some(l=>l.project===ps[0].id&&l.deal===os[0].id))continue;add(os[0],ps[0],reason);}
const companyAssignments=d.deals.filter(o=>!o.account_id&&o.primary_contact_id).map(o=>({o,c:d.contacts.find(c=>c.id===o.primary_contact_id)})).filter(({c})=>c?.account_id).map(({o,c})=>({id:o.id,name:o.name,account_id:canonical.get(c.account_id)||c.account_id,reason:'Missing source sales company recovered through its explicitly linked canonical contact.'}));
companyAssignments.push({id:'fb046711-677a-8879-9c0f-44bfcc0ef53d',name:'GALVEX investor prospect lead',account_id:named('GALVEX, spol. s r.o.').id,reason:'Explicit GALVEX sale and matching original GALVEX investor prospect source contact; unique canonical GALVEX company. Delivery scope remains unresolved.'});
const manualContacts=[{survivor:'fa9c823f-7ff4-b8b0-7309-bce08cac03b2',duplicate:'11c78401-b2a1-825b-a4d4-586a2ee1c46b',reason:'Same Gevorg AYRUMYAN, same reconciled A.Barbers company; original CU/PD aliases retained.'}];
const unresolved=d.deals.filter(o=>o.stage==='Won'&&!d.projects.some(p=>p.opportunity_id===o.id)&&!links.some(l=>l.deal===o.id)).map(o=>({id:o.id,name:o.name,amount:o.amount,company:byId.get(companyAssignments.find(a=>a.id===o.id)?.account_id||canonical.get(o.account_id)||o.account_id)?.name||null,reason:dealCandidates(d,canonical).find(z=>z.id===o.id)?.matches.length?'Multiple or incompatible original delivery scopes; human confirmation required.':'No corresponding imported delivery project found; no project fabricated.'}));
const plan={version:1,source_hash:d.audit_source,merges,patches,links,companyAssignments,contactMerges:manualContacts,issues:{unresolved_won:unresolved,conflicting_company_facts:factIssues},baseline:{accounts:d.accounts.length,contacts:d.contacts.length,projects:d.projects.length,deals:d.deals.length}};
fs.writeFileSync(process.argv[3],JSON.stringify(plan,null,2),{mode:0o600});
console.log(JSON.stringify({merges:merges.length,companyFactPatches:patches.length,newProjectLinks:links.length,dealsLinked:new Set(links.map(l=>l.deal)).size,assignments:companyAssignments,contactMerges:manualContacts.length,issues:plan.issues,links:links.map(({project_name,deal_name,project_value,deal_value,reason})=>({project_name,deal_name,project_value,deal_value,reason}))},null,2));
