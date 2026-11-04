// One-time, reviewable BizBase name repair. Never writes to source systems.
const text=value=>String(value??'').trim().replace(/\s+/g,' ');
const key=value=>text(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z]/g,'');
const email=value=>/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(text(value))?text(value).toLowerCase():'';
const titles=/^(?:(?:Ing|Mgr|Bc|JUDr|MUDr|PhDr|RNDr|Dr|prof|doc)\.\s*)+/i;
const generic=/^(info|office|marketing|sales|kontakt|contact|hello|ahoj|admin|support|faktury|fakturacia|konatel|recepcia|test|testemail|noreply|webinar|obchod|objednavky|me)$/i;
const placeholders=/^(?:full report\b|guest customer\b|test\b|xy$|me$|[.]+$|áno\s*$|ano\s*$|jasne\s*\)?$|galvex investor prospect)/i;
const common=`adela adriana adrian alena alex alexandra andrej andrea anita anna anton barbora beata benjamin boris branislav bruno carolina daniel daniela david denis dominik dusan edita elena emil emilia erik erika eva filip frantisek frederik gabriel gabriela gevorg helena henrich henrieta igor ilona ingrid ivan ivana iveta ivica jakub jan jana janka jaroslav jaroslava jergus jiri jozef judita julia juraj kamil karol karolina katarina katka kristian kristina kornel laura lea lenka lubomir lubos lucia ludmila lukas luis marek maria marian mario marta martin martina matej matus michael michaela michal michaela milan milena milos miroslav miroslava monika natalia nicolas niko nikola ondrej oskar patrik pavol peter petra radek radoslav radovan rastislav renata richard robert roberta roman romana rudolf samuel simon simona slavomir stanislav stefan svetlana tadeas tamara tatiana terezia tibor timea tina tomas valeria veronika viktor viliam vladimir zuzana`.split(' ');
export const FIRST_NAMES=new Set(common);
for(const name of ['marcela','dasa','saska','ivetka','jaro','sonicka','ivet','mato'])FIRST_NAMES.add(name);
const cap=value=>text(value).split(/([-'])/).map(part=>/^[-']$/.test(part)?part:part===part.toLowerCase()||part===part.toUpperCase()?part.charAt(0).toUpperCase()+part.slice(1).toLowerCase():part).join('');
const personWord=value=>/^[\p{L}][\p{L}'’-]*\.?$/u.test(value);
export function splitPersonName(value,company='') {
 let full=text(value);if(!full||email(full)||placeholders.test(full))return null;
 full=full.replace(/^Áno\s+(?=[\p{Lu}])/u,'');
 full=full.replace(/\s*(?:\s[-–—=]\s|,\s*(?:Ing\.|Mgr\.|MBA|CEO|CFO|COO|owner|founder)|\s+(?:Owner|Director|CEO|Co-Founder)\b).*$/i,'').trim();
 const prefix=full.match(titles)?.[0]||'';full=full.slice(prefix.length);
 // Remove a company appended after a person's name only when its actual name
 // matches; never discard an arbitrary third name.
 full=full.replace(/^([\p{Lu}])\.(?=[\p{L}])/u,'$1. ');
 const words=full.split(' ');
 if(words.length>2&&company){for(let n=2;n<words.length;n++)if(key(words.slice(n).join(' '))===key(company)){full=words.slice(0,n).join(' ');break;}}
 const parts=full.split(' ').filter(Boolean);
 if(parts.length<2||parts.length>5||parts.some(part=>!personWord(part)))return null;
 if(!FIRST_NAMES.has(key(parts[0]))&&!/^[\p{Lu}]\.?$/u.test(parts[0]))return null;
 return {first_name:(prefix?prefix.trim()+' ':'')+(parts[0].length<=2&&parts[0].endsWith('.')?parts[0]:cap(parts[0])),last_name:parts.slice(1).map(cap).join(' ')};
}
export function inferEmailName(value,knownFirst='') {
 const address=email(value);if(!address)return null;
 const local=address.split('@')[0].split('+')[0];
 if(generic.test(local)||local.length<3||/\b(?:academy|jazykovedko|design|consulting)\b/.test(local))return null;
 const parts=local.split(/[._-]+/).map(part=>part.replace(/\d+$/,'')).filter(Boolean);
 const given=key(text(knownFirst).replace(titles,''));
 if(parts.length===2&&parts.every(part=>/^[\p{L}]+$/u.test(part))){
  const [a,b]=parts;
  if(FIRST_NAMES.has(key(a))||a.length===1||given===key(a))return {first_name:a.length===1?(given.startsWith(key(a))?knownFirst:cap(a)+'.'):cap(a),last_name:cap(b)};
  if(FIRST_NAMES.has(key(b))||b.length===1||given===key(b))return {first_name:b.length===1?(given.startsWith(key(b))?knownFirst:cap(b)+'.'):cap(b),last_name:cap(a)};
  return null;
 }
 if(parts.length!==1)return null;
 const joined=local.replace(/\d+$/,'');
 if(FIRST_NAMES.has(key(joined)))return {first_name:cap(joined),last_name:null};
 const candidates=[];
 for(const first of FIRST_NAMES){
  if(first.length<4)continue;
  if(joined.startsWith(first)){const rest=joined.slice(first.length).replace(/^\d+/, '');if(rest.length>=4&&/^[a-z]+$/.test(rest)&&!generic.test(rest))candidates.push({first_name:cap(first),last_name:cap(rest)});}
  if(joined.endsWith(first)){const rest=joined.slice(0,-first.length);if(rest.length>=4&&/^[a-z]+$/.test(rest)&&!generic.test(rest))candidates.push({first_name:cap(first),last_name:cap(rest)});}
 }
 const unique=[...new Map(candidates.map(c=>[c.first_name+' '+c.last_name,c])).values()];
 return unique.length===1?unique[0]:null;
}
function sourceNames(source,company){
 const fields=source.fields||[];
 const get=names=>fields.find(f=>names.includes(text(f.name).toUpperCase())&&text(f.value))?.value;
 const first=text(source.first_name||get(['FIRST NAME','FIRST_NAME','MENO']));
 const last=text(source.last_name||get(['LAST NAME','LAST_NAME','PRIEZVISKO']));
 const candidates=[];
 if(first&&last&&!placeholders.test(first)&&!email(first)&&key(first)!==key(last))candidates.push({first_name:first,last_name:last});
 for(const value of [get(['NAME','FULL NAME']),source.name,first]){const split=splitPersonName(value,company);if(split)candidates.push(split);}
 return candidates;
}
export function planContactNameCleanup(contacts,sources=[]) {
 const sourceMap=new Map();
 for(const s of sources){const list=sourceMap.get(s.canonical_id)||[];list.push(s);sourceMap.set(s.canonical_id,list);}
 const byEmail=new Map();
 for(const c of contacts){const e=email(c.email);if(!e||generic.test(e.split('@')[0]))continue;const list=byEmail.get(e)||[];
  if(c.first_name&&c.last_name&&!placeholders.test(c.first_name)&&!email(c.first_name))list.push({first_name:text(c.first_name),last_name:text(c.last_name)});
  const split=splitPersonName(c.first_name,c.company);if(split&&!c.last_name)list.push(split);byEmail.set(e,list);
 }
 for(const s of sources){const c=contacts.find(c=>c.id===s.canonical_id);if(!c)continue;
  const addresses=[email(c.email),...(s.fields||[]).filter(f=>['EMAIL','E-MAIL'].includes(text(f.name).toUpperCase())).map(f=>email(f.value))].filter(Boolean);
  for(const e of addresses){if(generic.test(e.split('@')[0]))continue;byEmail.set(e,[...(byEmail.get(e)||[]),...sourceNames(s,c.company)]);}
 }
 const patches=[],review=[];
 for(const c of contacts){
  const first=text(c.first_name),last=text(c.last_name),address=email(c.email)||email(first);
  const before={first_name:c.first_name,last_name:c.last_name,email:c.email};
  let next=null,reason='';
  if(first&&/^(?:ml|st|jr|sr)\.?$/i.test(last)){
   const split=splitPersonName(first,c.company);
   if(split){next={first_name:split.first_name,last_name:split.last_name+' '+last};reason='Move surname out of First name; preserve generational suffix';}
  }
  // A whole name duplicated ahead of an already separate surname.
  if(first&&last&&key(first)!==key(last)){
   const parts=first.split(' '),tail=last.split(' ');
   if(parts.length>tail.length&&key(parts.slice(-tail.length).join(' '))===key(last)){
    next={first_name:parts.slice(0,-tail.length).join(' '),last_name:last};reason='Remove repeated surname from First name';
   }
  }
  if(!last){
   next=splitPersonName(first,c.company);
   if(next)reason='Split full name stored in First name';
   if(!next){
    const missing=!first||placeholders.test(first)||email(first)||titles.test(first)&&!text(first.replace(titles,''));
    const candidates=[...(sourceMap.get(c.id)||[]).flatMap(s=>sourceNames(s,c.company)),...(byEmail.get(address)||[])];
    const compatible=candidates.filter(n=>missing||key(n.first_name.replace(titles,''))===key(first.replace(titles,'')));
    const distinct=[...new Map(compatible.map(n=>[key(n.first_name)+' '+key(n.last_name),n])).values()];
    // Accent variants are the same name; prefer the source version with accents.
    if(distinct.length===1){next=distinct[0];reason='Recover name from source or matching personal email';}
    if(!next&&address){const inferred=inferEmailName(address,missing?'':first);
     const companyTail=inferred?.last_name&&key(first).startsWith(key(inferred.first_name+inferred.last_name))&&/\b(?:s\.?\s*r\.?\s*o\.?|ltd|gmbh|llc)\b/i.test(first);
     if(inferred&&(missing||companyTail||key(inferred.first_name)===key(first.replace(titles,'')))){
     next={first_name:missing||companyTail?inferred.first_name:first,last_name:inferred.last_name};reason='Derive name from personal email';
    }}
   }
  }
  if(next&&(next.first_name!==first||text(next.last_name)!==last)){
   const after={...before,...next};
   // An address misplaced in First name must remain accessible after repair.
   if(!email(c.email)&&email(first)&&!contacts.some(o=>o.id!==c.id&&o.account_id===c.account_id&&email(o.email)===email(first)))after.email=email(first);
   patches.push({id:c.id,company:c.company,before,after,reason});
  }else if(!last)review.push({id:c.id,first_name:c.first_name,last_name:c.last_name,email:c.email,company:c.company,reason:'No unambiguous full name or personal email pattern'});
 }
 return {total:contacts.length,patches,review};
}
