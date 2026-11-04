// Pure reconciliation rules. Source systems are never mutated by this module.
export const text = value => String(value ?? '').trim();
export const normalized = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const companyKey = value => normalized(value).replace(/\b(spol s r o|spol sro|s r o|sro|a s|as|ltd|limited|gmbh|inc|llc)\s*$/,'').replace(/[^a-z0-9]/g,'');
export const legalType = value => /\b(?:s\s*\.?\s*r\s*\.?\s*o\.?|sro)\s*$/i.test(text(value))?'sro':/\ba\s*\.?\s*s\.?\s*$/i.test(text(value))?'as':'';
export const validCompany = value => companyKey(value).length>=3&&!['unknown','nezadane','neuvedene','none','sukromnaosoba','sukromne','test','company','firma'].includes(companyKey(value));
export const emailKey = value => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(text(value))?text(value).toLowerCase():'';
export const domain = value => {
  const raw=text(value).toLowerCase();if(!raw)return '';
  if(emailKey(raw))return raw.split('@')[1];
  try{return new URL(raw.includes('://')?raw:`https://${raw}`).hostname.replace(/^www\./,'');}catch{return '';}
};
const freeMail=new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','hotmail.com','outlook.com','live.com','icloud.com','me.com','aol.com','zoznam.sk','azet.sk','centrum.sk','centrum.cz','post.sk','pobox.sk','seznam.cz','email.cz','atlas.sk','atlas.cz','proton.me','protonmail.com','gmx.com','mail.com']);
export const nameKey = value => normalized(text(value).split(' - ')[0].replace(/,\s*(CEO|CFO|COO|founder|konatel).*$/i,'').replace(/\b(?:ing|mgr|bc|phdr|phd|judr|mudr|mba|msc|pani|pan)\.?\b/gi,'')).split(' ').filter((word,index,words)=>word&&word!==words[index-1]).join(' ');
export const personName = row => [row.first_name,row.last_name].filter(Boolean).join(' ').trim();
export function compatibleNames(a,b) {
  const left=nameKey(a),right=nameKey(b);
  if(!left||!right||emailKey(left)||emailKey(right))return true;
  return left===right;
}
export function companyNameScore(name) {
  if(!validCompany(name))return -100;
  return (legalType(name)?100:0)+(/[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]/.test(name)?15:0)+(name.normalize('NFD')!==name?2:0)+Math.min(text(name).length,80)/100;
}
export function preferredCompanyName(names) {
  return [...new Set(names.map(text).filter(Boolean))].sort((a,b)=>companyNameScore(b)-companyNameScore(a))[0]||'';
}
export function preferredPersonName(names) {
  const score=name=>(/[a-záäčďéíĺľňóôŕšťúýž]/.test(name)&&/[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]/.test(name)?30:/[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]/.test(name)?15:0)+(name.normalize('NFD')!==name?4:0)+(nameKey(name).split(' ').length>=2?10:0)-(/\b(\w+)\s+\1\b/i.test(name)?20:0)-(/ - |,\s*(CEO|CFO|COO|founder)/i.test(name)?15:0)-(/^(full report|guest customer)\b/i.test(name)?100:0);
  return [...new Set(names.map(text).filter(name=>name&&!emailKey(name)))].sort((a,b)=>score(b)-score(a))[0]||'';
}
export function preferredEmail(emails,company={}) {
  const candidates=[...new Set(emails.map(emailKey).filter(Boolean))];
  const companyDomain=domain(company.website),key=companyKey(company.name);
  const score=email=>{
    const host=domain(email),stem=host.split('.')[0].replace(/[^a-z0-9]/g,'');
    const companyMatch=(companyDomain&&(host===companyDomain||host.endsWith('.'+companyDomain)))||(key.length>=4&&stem.length>=4&&(key===stem||key.startsWith(stem)||stem.startsWith(key)));
    return (companyMatch?100:freeMail.has(host)?0:30)+(!/^(info|office|kontakt|contact|sales|faktury|fakturacia|admin|hello|recepcia)\b/.test(email.split('@')[0])?3:0);
  };
  return candidates.sort((a,b)=>score(b)-score(a))[0]||null;
}
export function canMergeCompanies(a,b) {
  const namesA=[a.name,...a.alternate_names||[]],namesB=[b.name,...b.alternate_names||[]];
  if(!namesA.some(name=>validCompany(name)&&namesB.some(other=>validCompany(other)&&companyKey(name)===companyKey(other))))return false;
  const taxA=text(a.tax_id),taxB=text(b.tax_id),typesA=new Set(namesA.map(legalType).filter(Boolean)),typesB=new Set(namesB.map(legalType).filter(Boolean));
  if(taxA&&taxB&&taxA!==taxB)return false;
  if(typesA.size&&typesB.size&&![...typesA].some(type=>typesB.has(type)))return false;
  const hostA=domain(a.website),hostB=domain(b.website);
  return !hostA||!hostB||hostA===hostB;
}
export function canMergePeople(a,b) {
  if(a.account_id&&b.account_id&&a.account_id!==b.account_id)return false;
  const nameA=personName(a),nameB=personName(b);
  const sameEmail=emailKey(a.email)&&emailKey(a.email)===emailKey(b.email);
  const phone=value=>text(value).replace(/\D/g,'').replace(/^00/,'');
  const samePhone=phone(a.phone).length>=8&&phone(a.phone)===phone(b.phone);
  const partsA=nameKey(nameA).split(' '),partsB=nameKey(nameB).split(' ');
  const partialPhoneName=samePhone&&partsA[0]&&partsA[0]===partsB[0]&&((partsA.length===1)!==(partsB.length===1));
  const matchingPhoneSurname=samePhone&&partsA.length===2&&partsB.length===2&&partsA[0]===partsB[0]&&Math.min(partsA[1].length,partsB[1].length)>=6&&(partsA[1].startsWith(partsB[1])||partsB[1].startsWith(partsA[1]));
  if(!compatibleNames(nameA,nameB)&&!partialPhoneName&&!matchingPhoneSurname)return false;
  const sameFullName=nameKey(nameA)===nameKey(nameB)&&nameKey(nameA).split(' ').length>=2&&nameKey(nameA).length>=6;
  if(sameEmail)return true;
  if(!a.account_id||!b.account_id)return samePhone&&(sameFullName||partialPhoneName||matchingPhoneSurname);
  return sameFullName||(samePhone&&Boolean(nameKey(nameA)&&nameKey(nameB)));
}
export function safeGroups(rows,compatible) {
  const groups=[];
  for(const row of rows){const group=groups.find(group=>group.every(member=>compatible(member,row)));if(group)group.push(row);else groups.push([row]);}
  return groups;
}
export function retainedValues(rows,fields) {
  return Object.fromEntries(fields.map(field=>[field,[...new Set(rows.map(row=>text(row[field])).filter(Boolean))]]));
}
