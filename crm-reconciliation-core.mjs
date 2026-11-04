import {companyKey,normalized,validCompany} from './contact-reconciliation.mjs';

const unique=values=>[...new Set(values.filter(Boolean).map(v=>String(v).trim()).filter(Boolean))];
const reg=value=>String(value||'').replace(/[^0-9a-z]/gi,'').toUpperCase();
const sourceKey=s=>`${s.system}:${s.system==='ClickUp'?s.container:'organization'}:${s.source_id}`;
export function companyFacts(snapshot){
 const identities=new Map(snapshot.identities.filter(i=>i.entity_type==='account').map(i=>[i.source_external_id,i.canonical_id]));
 for(const a of snapshot.accounts)if(a.source_external_id)identities.set(a.source_external_id,a.id);
 return snapshot.accounts.map(a=>{
  const sources=snapshot.source_accounts.filter(s=>identities.get(sourceKey(s))===a.id);
  const values=name=>sources.flatMap(s=>(s.fields||[]).filter(f=>f.name.toUpperCase()===name).map(f=>f.value));
  const legalNames=unique([a.legal_name,...values('LEGAL NAME')]);
  const sourceNames=unique(sources.map(s=>s.name));
  const taxIds=unique([a.registration_number,...values('ICO'),...values('IČO')].map(reg)).filter(x=>x.length>=6);
  const names=unique([a.name,a.trading_name,...sourceNames,...legalNames]);
  return {...a,sources,sourceNames,legalNames,taxIds,names,nameKeys:unique(names.filter(validCompany).map(companyKey)),addresses:unique([a.address,...sources.map(s=>{const val=name=>(s.fields||[]).find(f=>f.name.toUpperCase()===name)?.value;return [val('ADDRESS'),val('CITY'),val('COUNTRY')].filter(Boolean).join(', ');})])};
 });
}
export function companyCandidates(facts){
 const result=[];
 for(let i=0;i<facts.length;i++)for(let j=i+1;j<facts.length;j++){
  const a=facts[i],b=facts[j];
  const sharedNames=a.nameKeys.filter(k=>b.nameKeys.includes(k));
  const sharedIds=a.taxIds.filter(k=>b.taxIds.includes(k));
  if(!sharedNames.length&&!sharedIds.length)continue;
  const conflict=a.taxIds.length>1||b.taxIds.length>1||(a.taxIds.length&&b.taxIds.length&&!sharedIds.length);
  result.push({a:a.id,b:b.id,names:[a.name,b.name],sharedNames,sharedIds,conflict,reason:sharedIds.length?'Matching registration number':'Matching original company name'});
 }
 return result;
}
const stop=new Set(['pre','pro','a','s','r','o','sro','as','the','deal','lead','follow','up','po','cez','sba','prf','sent','from','pipedrive','piepdrive']);
export function scopeWords(value){return normalized(value).split(' ').filter(x=>x.length>2&&!stop.has(x));}
const scope=value=>new Set(scopeWords(value));
export function scopeOverlap(a,b){const x=scope(a),y=scope(b);return [...x].filter(k=>y.has(k));}
export function amountEquals(a,b){return a!==null&&a!==undefined&&b!==null&&b!==undefined&&Math.round(Number(a)*100)===Math.round(Number(b)*100);}
export function dealCandidates(snapshot,accountMap=new Map()){
 const canonical=id=>accountMap.get(id)||id;
 return snapshot.deals.filter(o=>o.stage==='Won').map(o=>{
  const matches=snapshot.projects.filter(p=>!p.opportunity_id&&o.account_id&&p.account_id&&canonical(p.account_id)===canonical(o.account_id)).map(p=>({id:p.id,name:p.name,value:p.contract_value,exactAmount:amountEquals(p.contract_value,o.amount),overlap:scopeOverlap(o.name,p.name),exactName:normalized(o.name)===normalized(p.name),status:p.status,existingDeal:p.opportunity_id}));
  return {id:o.id,name:o.name,company:canonical(o.account_id),amount:o.amount,existingProjects:snapshot.projects.filter(p=>p.opportunity_id===o.id).map(p=>p.id),matches};
 });
}
