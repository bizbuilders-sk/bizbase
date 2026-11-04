import fs from 'node:fs';
import {DEFINITIONS} from '../src/workspace-model.ts';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const report=read('docs/field-decisions-review-2026-10-27.json');
const sheet=read('docs/field-sheet-edits-2026-11-04.json');
const edits=new Map(sheet.changes.filter(x=>x.type==='Changed').map(x=>[x.key.slice(0,2).join(':'),x]));
const byId=new Map(report.rows.map(x=>[x.id,x]));
const aliases={
 'accounts:trading_name':'accounts:name','accounts:legal_name':'accounts:name',
 'opportunities:deal_product':'opportunities:proposed_services',
 'opportunities:deal_channel':'opportunities:acquisition_channel',
 'opportunities:deal_revenue_band':'accounts:revenue_band',
 'vendor_costs:vendor_name':'vendor_costs:vendor_id',
 'event_participations:response_learned':'event_participations:response_heard_about',
 'event_participations:response_lead_form':'design:form_id'
};
const tableNames={contacts:'Contact',accounts:'Company',opportunities:'Deal',projects:'Project',services:'Service',opportunity_services:'Deal service line',project_services:'Project service line',vendor_costs:'Vendor cost',event_participations:'Form response / Event registration',events:'Event',team_members:'Team'};
const financialIds=['projects:planned_revenue','projects:planned_cost','vendor_costs:planned_amount','vendor_costs:actual_amount'];
const fields=[],omitted=[];
for(const row of report.rows){
 const meta=DEFINITIONS[row.table]?.fields.find(f=>f.key===row.key);
 // A source field and its linked projections represent one owned fact.
 if(meta?.linked||meta?.registrationScope||meta?.eventScope||row.key.startsWith('company__'))continue;
 if(row.id.startsWith('design:')){
  if(row.id==='design:form_id')fields.push({...row,owner:'Form response / Event registration',table:'event_participations',displays:[],decision:'Keep',status:'Agreed'});
  continue;
 }
 if(aliases[row.id]){omitted.push({id:row.id,label:row.label,action:'Merged',into:aliases[row.id]});continue;}
 if(row.key==='notes'||row.key==='deal_imported_notes'||/response_(follow_up_notes|dc_notes|source_notes|contact_notes)$/.test(row.key))continue;
 if(row.key.includes('src__')||['received_on','added_on','source','source_system','sort_order'].includes(row.key)){
  omitted.push({id:row.id,label:row.label,action:'Source / internal detail'});continue;
 }
 const item={...row,owner:tableNames[row.table],displays:[],status:row.approval==='Recommended'?'Recommendation':'Agreed'};
 const edit=edits.get(row.id);
 if(edit){
  item.status='Edited in your sheet';
  const changed=edit.changes;
  for(const [col,key] of [['D','column'],['E','filter'],['F','group']])if(changed[col])item[key]=changed[col].after==='Yes';
  if(changed.B)item.label=changed.B.after;
  if(changed.G)item.decision=changed.G.after;
  else if(['D','E','F'].some(c=>changed[c]?.after==='Yes')&&/History only|Remove/.test(item.decision))item.decision='Keep';
  if(changed.N)item.userNote=changed.N.after;
 }
 if(financialIds.includes(row.id)&&item.decision==='Remove'){
  item.status='One financial-display question remains';item.reviewQuestion='financial-display';
  item.column=item.filter=item.group=null;
 }else if(/Remove|Historical only|History only/.test(item.decision)){
  omitted.push({id:row.id,label:row.label,action:'Removed from active field review; evidence retained',status:item.status});continue;
 }
 fields.push(item);
}
const indexed=new Map(fields.map(f=>[f.id,f]));
for(const row of report.rows){
 const meta=DEFINITIONS[row.table]?.fields.find(f=>f.key===row.key);
 let id=meta?.linked?meta.linked.table+':'+meta.linked.field:null;
 if(meta?.registrationScope)id='event_participations:'+meta.registrationKey;
 if(meta?.eventScope)id='event_participations:event_id';
 if(row.key.startsWith('company__'))id='accounts:'+row.key.replace(/^company__/,'');
 if(!id)continue;
 id=aliases[id]||id;const field=indexed.get(id);if(!field)continue;
 const display={screen:row.screen,column:row.column,filter:row.filter,group:row.group,decision:row.decision};
 const e=edits.get(row.id);
 if(e){for(const [col,key] of [['D','column'],['E','filter'],['F','group']])if(e.changes[col])display[key]=e.changes[col].after==='Yes';if(e.changes.G)display.decision=e.changes.G.after;}
 if(/Remove|Move|History|Merge/.test(display.decision))display.column=display.filter=display.group=false;
 field.displays.push(display);
}
// When an alias was edited explicitly, retain that instruction with its owner.
for(const [from,to] of Object.entries(aliases)){
 const target=indexed.get(to),edit=edits.get(from);if(!target||!edit)continue;
 target.aliasInstructions??=[];
 target.aliasInstructions.push({sourceField:byId.get(from)?.originalLabel||from,changedCells:edit.changes});
 // Company name merges and discovery-channel merges have already been agreed.
 // Acquisition-channel display settings apply to one canonical sales-origin field.
 if(from==='opportunities:deal_channel'){
  for(const [col,key] of [['D','column'],['E','filter'],['F','group']])if(edit.changes[col])target[key]=edit.changes[col].after==='Yes';
  target.status='Edited in your sheet';
  target.reason='One Acquisition channel field. Preserve the original Pipedrive wording/mapping in history rather than present two parallel channels.';
 }
}
const questions=[{id:'financial-display',title:'Financial amounts — where should they be shown?',
 context:'The sheet marks Project Revenue plan / Vendor budget and Vendor cost Budget / Actual as Remove. Because the previous report repeated fields and mixed table controls with field existence, the intended scope is unclear.',
 recommendation:'Retain the underlying amounts and calculations. Decide whether they belong in main tables or financial detail views. No financial data deletion is proposed.',
 source:'Entity fields: rows 73–74 and 96–97',fields:financialIds}];
const result={date:'2026-11-04',sourceWorkbook:sheet.source,baselineReport:report.date,
 explanation:'One row per owning field. Linked displays are nested details, never duplicate rows. Existing sheet edits are preserved as instructions; unchanged original-export defaults do not cancel later agreements.',
 state:'Review only; app and database unchanged',notes:{decision:'One contextual Notes feature',controls:'Column only',contexts:['Contact','Company','Deal','Project','Form response / Event participation'],preservation:'Preserve text, source, original dates/authors when known, and original context for ambiguous imports.'},
 formFields:'Questions belong to a Form definition. Each submission stores its own answers and links to the relevant Event when applicable. + Add field creates form-specific questions.',
 questions,fields,omitted};
if(new Set(fields.map(f=>f.id)).size!==fields.length)throw Error('Duplicate owned field');
fs.writeFileSync('docs/field-review-simple-2026-11-04.json',JSON.stringify(result,null,2)+'\n');
const escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const embeddedData=JSON.stringify(result).replaceAll('<','\\u003c');
const client=fs.readFileSync('scripts/field-review-client.js','utf8');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BizBase — editable field review</title><style>
body{margin:0;background:#f3f5f5;color:#142b34;font:16px/1.55 system-ui,sans-serif}*{box-sizing:border-box}main{max-width:1320px;margin:32px auto;padding:0 24px}h1{font-size:32px;line-height:1.2;letter-spacing:-.7px}h2{font-size:20px}p{max-width:1000px}.panel,.entity{background:white;border:1px solid #dce3e4;border-radius:10px;padding:20px;margin:16px 0}.question{border-left:5px solid #facd11}small{font-size:12px;color:#677b83;display:block}.entity>summary{font-weight:750;font-size:20px;cursor:pointer}.entity>summary small{display:inline;margin-left:10px;font-weight:400}.scroll{overflow-x:auto;margin-top:16px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #e2e7e8}th{background:#f4f6f6}td:first-child{min-width:185px}td:last-child{min-width:235px}td details summary{cursor:pointer}input,select,textarea,button{font:inherit;border:1px solid #c4cfd3;border-radius:6px;padding:9px;color:inherit;background:white}td input,td select,td textarea{width:100%}td input{font-weight:650}td:nth-child(2){min-width:180px}td:nth-child(3),td:nth-child(4),td:nth-child(5){min-width:88px}textarea{min-height:64px;resize:vertical}select:disabled{background:#f2f4f5;color:#7a858c}button{font-weight:750;cursor:pointer}.primary{background:#facd11;border-color:#facd11}.toolbar{position:sticky;top:0;z-index:2;background:#f3f5f5;padding:12px 0;display:flex;align-items:center;gap:18px;flex-wrap:wrap}.toolbar label{display:flex;align-items:center;gap:8px;font-size:14px}.toolbar input{width:auto}#save-status{font-size:13px;color:#526973}.edited{background:#fffced}input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid #8d7cae;outline-offset:2px}footer{color:#61757e;font-size:13px;padding:20px 0}#finance-answer{width:100%;max-width:600px}noscript{display:block;background:#fff0c4;padding:15px}@media(max-width:700px){main{padding:0 14px}.panel,.entity{padding:14px}h1{font-size:27px}}
</style></head><body><main><h1>Field review — one field, one owner</h1><p>Open an entity and edit its fields directly. When finished, click <b>Download edits</b> and send the downloaded file in our chat. Your original spreadsheet stays intact.</p>
<div class="toolbar"><button id="download-edits" class="primary">Download edits</button><label><input type="checkbox" id="only-changes">Only my changes</label><span id="save-status" role="status"></span></div>
<section class="panel question"><h2>Financial amounts — where should they be shown?</h2><p>The four amounts marked Remove can be kept in financial details or also shown in main tables. The underlying financial data stays preserved.</p><label for="finance-answer">Your preference</label><br><select id="finance-answer"><option value="">Choose when ready</option value="Financial details only">Financial details only</option><option value="Main tables and financial details">Main tables and financial details</option><option value="Mixed — see field decisions and comments">Mixed — see field decisions and comments</option><option value="Discuss with me">Discuss with me</option></select><small>This answer is saved separately; it does not overwrite individual field choices.</small></section>
<details class="panel"><summary>How to use this review</summary><p><b>Keep:</b> retain the field. <b>Card only:</b> keep it in record details and remove it from table controls. <b>Remove from active use:</b> retire the active field while preserving original evidence and necessary backend data. <b>Merge:</b> describe the target in your comment. <b>Review:</b> flag a question for discussion.</p><p>Column / Filter / Group apply to the owning entity’s table. Other screens are shown under Context for reference; describe any linked-display changes in the comment. Disabled table controls mean the field is Card only or removed.</p><p>Your edits are saved in this browser when supported. Use Download edits before closing if saving is unavailable. Nothing is automatically applied to BizBase.</p></details>
<div id="field-sections"></div><noscript>Enable JavaScript to edit this review. The original spreadsheet remains available in the project folder.</noscript>
<details class="panel"><summary>Removed / merged / internal entries — reference only</summary><p>These prior decisions are retained, rather than repeated in the main review. To revisit one, name the field in your message.</p><ul>${omitted.map(field=>'<li>'+escapeHtml(field.label)+' — '+escapeHtml(field.action)+'</li>').join('')}</ul></details>
<footer>4 November 2026 · Review only. No changes applied to the app, database or source systems.</footer></main><script type="application/json" id="review-data">${embeddedData}</script><script>${client}</script></body></html>`;
fs.writeFileSync('docs/field-review-simple-2026-11-04.html',html);
console.log(JSON.stringify({ownedFields:fields.length,editable:true,questions:questions.length,duplicateRows:0}));
