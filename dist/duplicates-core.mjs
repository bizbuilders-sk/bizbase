const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeCompany = value => normalize(String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(s\s*\.?\s*r\s*\.?\s*o\.?|a\s*\.?\s*s\.?|ltd\.?|limited|gmbh|inc\.?|llc)\b/g, ' '));
const websiteKey = value => {
  const raw=String(value||'').trim().toLowerCase();if(!raw)return '';
  try{return new URL(raw.includes('://')?raw:`https://${raw}`).hostname.replace(/^www\./,'').toLowerCase();}
  catch{return raw.replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[/?#]/)[0];}
};
const emailKey = value => String(value || '').trim().toLowerCase();
const phoneKey = value => String(value || '').replace(/\D/g, '').replace(/^00/, '');
const fullName = row => [row.first_name, row.last_name].filter(Boolean).join(' ').trim();

function similarity(a,b){
  a=normalize(a);b=normalize(b);if(!a||!b)return 0;if(a===b)return 1;
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let diagonal=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const above=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=above;}}
  return 1-row[b.length]/Math.max(a.length,b.length);
}

export function findDuplicateCandidates(accounts=[],contacts=[]){
  const candidates=[];
  for(let i=0;i<accounts.length;i++)for(let j=i+1;j<accounts.length;j++){
    const a=accounts[i],b=accounts[j],reasons=[];let score=0;
    const an=normalizeCompany(a.name),bn=normalizeCompany(b.name),aw=websiteKey(a.website),bw=websiteKey(b.website);
    if(aw&&bw&&aw===bw){score=100;reasons.push('Same website');}
    if(an&&an===bn){score=Math.max(score,98);reasons.push('Same company name');}
    else if(an&&bn&&similarity(an,bn)>=.9){score=Math.max(score,85);reasons.push('Very similar company name');}
    if(score>=85)candidates.push({type:'account',left:a,right:b,score,reasons});
  }
  const byAccount=new Map();
  for(const c of contacts){if(!byAccount.has(c.account_id))byAccount.set(c.account_id,[]);byAccount.get(c.account_id).push(c);}
  for(const list of byAccount.values())for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
    const a=list[i],b=list[j],reasons=[];let score=0;
    const ae=emailKey(a.email),be=emailKey(b.email),ap=phoneKey(a.phone),bp=phoneKey(b.phone),an=normalize(fullName(a)),bn=normalize(fullName(b));
    if(ae&&be&&ae===be){score=100;reasons.push('Same email address');}
    if(ap&&bp&&ap===bp){score=Math.max(score,98);reasons.push('Same phone number');}
    if(an&&an===bn){score=Math.max(score,92);reasons.push('Same name in the same company');}
    if(score>=92)candidates.push({type:'contact',left:a,right:b,score,reasons});
  }
  return candidates.sort((a,b)=>b.score-a.score||String(a.left.name||fullName(a.left)).localeCompare(String(b.left.name||fullName(b.left))));
}
