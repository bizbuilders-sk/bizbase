import {readFileSync,writeFileSync} from 'node:fs';
import {planContactNameCleanup} from '../contact-name-cleanup.mjs';
const contacts=JSON.parse(readFileSync('outputs/contact-name-cleanup-before-2026-10-26.json','utf8'));
const sources=JSON.parse(readFileSync('outputs/contact-name-cleanup-sources-2026-10-26.json','utf8'));
const plan=planContactNameCleanup(contacts,sources);
writeFileSync('outputs/contact-name-cleanup-plan-2026-10-26.json',JSON.stringify(plan,null,2));
console.log(JSON.stringify({total:plan.total,changes:plan.patches.length,review:plan.review.length,reasons:plan.patches.reduce((a,p)=>(a[p.reason]=(a[p.reason]||0)+1,a),{})},null,2));
for(const p of plan.patches)console.log(JSON.stringify({id:p.id.slice(0,8),before:[p.before.first_name,p.before.last_name],after:[p.after.first_name,p.after.last_name],email:p.after.email,reason:p.reason}));
