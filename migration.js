import {ROOT_LISTS,validateSnapshot,stagingRow,sourceField,displayField} from './migration-core.mjs';
import {csvToSnapshot} from './clickup-csv.mjs';

const reviews=['Needs review','Reviewed','Verified','Conflict','Rejected'];
const columns={
  account:['LEGAL NAME','ICO','INVOICE EMAIL'],contact:['Email','Phone','COMPANY'],
  project:['CLIENT','SERVICE GROUP','Project Price (predane za)','PROJECT PHASE'],
  service:[],vendor:['INVOICE EMAIL','Contact Name','Service Type'],
  vendor_cost:['EXT ORDERS PER PROJECT','VENDOR','Budget','Final invoice','FIN MONTH'],
  revenue:['CLIENT','INVOICING','TOTAL PRICE','Invoice ID','FIN MONTH'],
  revenue_plan:['FIN MONTH','PLAN','AT HOME','DELIVERY TO CLOSE','DELIVERY TO FOLLOW-UP']
};
export function createMigration({request,connected,render,escape:esc,pageHead,modal,toast}) {
  const model={listId:'901515195994',review:'',search:'',page:0,index:[],rows:[],loading:false,loaded:false,error:'',busy:false,progress:'',expected:0};
  let requestVersion=0;
  const identity=r=>`${r.source_container_id}:${r.source_record_id}`;
  const filtered=()=>model.index.filter(r=>r.source_container_id===model.listId&&(!model.review||r.validation_status===model.review)&&(!model.search||String(r.record_name||'').toLocaleLowerCase().includes(model.search.toLocaleLowerCase()))).sort((a,b)=>String(a.record_name||'').localeCompare(String(b.record_name||'')));
  const scope=()=>ROOT_LISTS.find(l=>l.id===model.listId);
  async function readIndex() {
    const result=[];
    for(let offset=0;;offset+=1000) {
      const page=await request(`migration_staging?select=id,source_container_id,source_record_id,validation_status,record_name:raw_record->>name&source_system=eq.ClickUp&order=id.asc&limit=1000&offset=${offset}`);
      result.push(...page);if(page.length<1000)break;
    }
    return result;
  }
  async function load(refresh=true) {
    if(!connected()){model.error='Connect Supabase in Settings to load or import source records.';render();return;}
    const version=++requestVersion;model.loading=true;model.error='';render();
    try {
      if(refresh||!model.loaded){const [index,events]=await Promise.all([readIndex(),request('integration_events?select=payload&integration=eq.ClickUp%20snapshot&order=received_at.desc&limit=1')]);if(version!==requestVersion)return;model.index=index;model.expected=events[0]?.payload?.expected_record_count||index.length;model.loaded=true;}
      const ids=filtered().slice(model.page*50,(model.page+1)*50).map(r=>r.id);
      const rows=ids.length?await request(`migration_staging?select=*&id=in.(${ids.join(',')})`):[];
      if(version!==requestVersion)return;
      const byId=new Map(rows.map(r=>[r.id,r]));model.rows=ids.map(id=>byId.get(id)).filter(Boolean);
    } catch(e) {if(version===requestVersion)model.error=`Could not load source records: ${e.message}`;}
    finally {if(version===requestVersion){model.loading=false;render();}}
  }
  function cellValue(raw,name) {
    const field=sourceField(raw,name),value=displayField(field);
    if(!value)return '<span class="source-muted">—</span>';
    const title=esc(value);
    if(field?.type==='currency'&&Number.isFinite(Number(field.value)))return `<span class="source-amount" title="${title}">${new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',minimumFractionDigits:2}).format(Number(field.value))}</span>`;
    return `<span class="source-value" title="${title}">${esc(value)}</span>`;
  }
  function view() {
    const total=filtered().length,list=scope(),fields=columns[list.type],count=id=>model.index.filter(r=>r.source_container_id===id).length;
    return pageHead('Source records','ClickUp · DELIVERY CONSOLE / 01 ROOT',`<button class="btn" data-source-refresh ${model.busy?'disabled':''}>Refresh</button><button class="btn" data-source-upload ${model.busy||!connected()?'disabled':''}>Import snapshot</button><button class="btn primary" data-source-csv ${model.busy?'disabled':''}>Import CSV</button><input id="source-file" type="file" accept="application/json,.json" hidden><input id="source-csv-file" type="file" accept="text/csv,.csv,text/tab-separated-values,.tsv" hidden>`)+
      `<div class="notice source-notice"><span><b>${model.index.length.toLocaleString()}${model.expected>model.index.length?` of ${model.expected.toLocaleString()}`:''} source records copied</b>${model.expected>model.index.length?` · ${(model.expected-model.index.length).toLocaleString()} remaining`:''} · Original values and relationships are retained. These records enter financial reports only after mapping and validation.</span></div>
      <div class="source-tabs" role="group" aria-label="ClickUp lists">${ROOT_LISTS.map(l=>`<button class="source-tab ${l.id===model.listId?'selected':''}" data-source-list="${l.id}" aria-pressed="${l.id===model.listId}">${l.name}<span>${count(l.id)}</span></button>`).join('')}</div>
      <div class="toolbar source-toolbar"><form id="source-search-form" class="search"><input name="query" aria-label="Search source records" placeholder="Search ${esc(list.name.toLowerCase())}" value="${esc(model.search)}"><button class="btn small" type="submit">Search</button></form><div class="filters"><label>Review <select id="source-review-filter" aria-label="Filter by review status"><option value="">All statuses</option>${reviews.map(s=>`<option ${model.review===s?'selected':''}>${s}</option>`).join('')}</select></label><span class="pill">${total} records</span></div></div>
      ${model.progress?`<div class="source-progress" role="status">${esc(model.progress)}</div>`:''}${model.error?`<div class="source-error" role="alert">${esc(model.error)}</div>`:''}
      <div class="card"><div class="table-wrap"><table class="table source-table"><thead><tr><th>Record</th><th>Source status</th>${fields.map(n=>`<th>${esc(n)}</th>`).join('')}<th>Review</th><th>Review notes</th></tr></thead><tbody>${model.loading?`<tr><td colspan="${4+fields.length}">Loading source records…</td></tr>`:model.rows.length?model.rows.map(r=>`<tr><td class="source-name"><button class="link source-record-link" data-source-detail="${r.id}">${esc(r.raw_record.name)}</button><span class="secondary">${esc(r.raw_record.task_type||r.record_type)}${r.raw_record.parent?' · Subtask':''}</span></td><td>${esc(typeof r.raw_record.status==='object'?r.raw_record.status?.status:r.raw_record.status||'—')}</td>${fields.map(n=>`<td>${cellValue(r.raw_record,n)}</td>`).join('')}<td><select class="cell-editor" aria-label="Review ${esc(r.raw_record.name)}" data-source-review="${r.id}" ${model.busy?'disabled':''}>${reviews.map(s=>`<option ${r.validation_status===s?'selected':''}>${s}</option>`).join('')}</select></td><td><input class="cell-editor source-review-notes" aria-label="Review notes for ${esc(r.raw_record.name)}" data-source-notes="${r.id}" value="${esc(r.validation_notes||'')}" ${model.busy?'disabled':''}></td></tr>`).join(''):`<tr><td colspan="${4+fields.length}" class="empty">${model.loaded?'No source records match this view.':'Refresh to load the source records.'}</td></tr>`}</tbody></table></div><div class="source-pagination"><span>${total?model.page*50+1:0}–${Math.min((model.page+1)*50,total)} of ${total}</span><div><button class="btn small" data-source-prev ${model.page===0||model.loading?'disabled':''}>Previous</button><button class="btn small" data-source-next ${(model.page+1)*50>=total||model.loading?'disabled':''}>Next</button></div></div></div>`;
  }
  async function importFile(file) {
    if(!file||model.busy)return;
    model.busy=true;model.error='';model.progress='Validating ClickUp snapshot…';render();
    try {
      if(!connected())throw Error('Connect Supabase before importing.');
      if(file.size>60*1024*1024)throw Error('Snapshot is too large (maximum 60 MB).');
      const snapshot=JSON.parse(await file.text()),records=validateSnapshot(snapshot);
      const existing=await readIndex(),known=new Set(existing.map(identity));
      const pending=records.filter(r=>!known.has(identity(r)));
      let copied=0;
      for(let i=0;i<pending.length;i+=25) {
        if(!connected())throw Error('Connection closed. Reconnect and import again to resume.');
        const rows=await Promise.all(pending.slice(i,i+25).map(r=>stagingRow(r,snapshot)));
        await request('migration_staging?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(rows)});
        copied+=rows.length;model.progress=`Copying to Supabase: ${copied.toLocaleString()} of ${pending.length.toLocaleString()} new records · ${records.length-pending.length} already present`;render();
      }
      model.index=await readIndex();
      const confirmed=new Set(model.index.map(identity)),missing=records.filter(r=>!confirmed.has(identity(r)));
      if(missing.length)throw Error(`${missing.length} records could not be verified. Import the same file again to resume.`);
      const expected=Math.max(snapshot.expected_record_count||records.length,model.expected,model.index.length),remaining=Math.max(0,expected-model.index.length);
      await request('integration_events?on_conflict=integration,external_event_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({integration:'ClickUp snapshot',external_event_id:`01 ROOT:${snapshot.exported_at||file.name||records.length}`,entity_type:'migration_staging',direction:'Inbound',status:'Processed',payload:{record_count:records.length,stored_record_count:model.index.length,expected_record_count:expected,source_format:snapshot.source_format||'snapshot',exported_at:snapshot.exported_at||null,scope:'DELIVERY CONSOLE / 01 ROOT',included_lists:ROOT_LISTS.map(l=>({name:l.name,count:records.filter(r=>r.source_container_id===l.id).length}))}})});
      model.progress=`${snapshot.source_format==='clickup.csv.v1'?'CSV':'Snapshot'} imported · ${copied.toLocaleString()} new records · ${records.length-pending.length} already present${remaining?` · ${remaining.toLocaleString()} still pending against the source inventory`:''}. Existing source records and reviews were preserved.`;
      model.page=0;model.loaded=true;
    } catch(e) {model.error=`Import stopped: ${e.message}. Previously copied records remain available; retry the same snapshot to resume.`;}
    finally {const importError=model.error;model.busy=false;await load(true);if(importError){model.error=importError;render();}}
  }
  async function previewCsv(file) {
    if(!file||model.busy)return;
    if(file.size>60*1024*1024){model.error='CSV is too large (maximum 60 MB).';render();return;}
    const text=await file.text();
    const dialog=modal('Import ClickUp CSV','Preview the source list and new records before copying.',`<div class="field"><label for="csv-scope">Source list in DELIVERY CONSOLE / 01 ROOT</label><select id="csv-scope">${ROOT_LISTS.map(l=>`<option value="${l.id}" ${l.id===model.listId?'selected':''}>${l.name}</option>`).join('')}</select></div><p class="card-sub">File: ${esc(file.name)}. Existing source IDs are kept. All CSV cells stay as exported text for review.</p><button class="btn" data-csv-prepare>Preview import</button><div data-csv-report role="status" style="margin-top:14px">Choose the source list, then preview the file.</div>`,`<button class="btn" data-close>Cancel</button><button class="btn primary" data-csv-confirm disabled>Import new records</button>`);
    const select=dialog.querySelector('#csv-scope'),prepare=dialog.querySelector('[data-csv-prepare]'),report=dialog.querySelector('[data-csv-report]'),confirm=dialog.querySelector('[data-csv-confirm]');
    let prepared=null,revision=0;
    select.addEventListener('change',()=>{revision++;prepared=null;confirm.disabled=true;report.textContent='Source changed. Preview the file again before importing.';});
    prepare.addEventListener('click',async()=>{
      const version=revision;prepare.disabled=true;confirm.disabled=true;prepared=null;report.textContent='Reading and checking the CSV…';
      try {
        const data=csvToSnapshot(text,select.value,file.name,model.expected);
        const existing=connected()?await readIndex():null;
        if(version!==revision)return;
        const known=new Set((existing||[]).map(identity)),newCount=data.snapshot.records.filter(r=>!known.has(identity(r))).length;
        prepared=data.snapshot;
        const shown=Math.min(6,data.headers.length);
        report.innerHTML=`<div class="source-progress"><b>${data.snapshot.record_count.toLocaleString()} unique ${data.snapshot.record_count===1?'task':'tasks'}</b>${existing?` · ${newCount.toLocaleString()} new · ${(data.snapshot.record_count-newCount).toLocaleString()} already copied`:' · Connect Supabase to check existing records and import'}${data.duplicates?` · ${data.duplicates} identical duplicate rows collapsed`:''}</div><div class="table-wrap"><table class="table source-csv-preview"><thead><tr>${data.headers.slice(0,shown).map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${data.samples.map(cells=>`<tr>${cells.slice(0,shown).map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="card-sub">Preview: first ${data.samples.length} records and ${shown} of ${data.headers.length} columns. Every exported column is retained. CSV relationship names and financial formats require review before operational use.</p>`;
        confirm.textContent=existing?`Import ${newCount.toLocaleString()} new records`:'Connect Supabase first';
        confirm.disabled=!existing||newCount===0;
      } catch(e){if(version===revision){report.textContent=e.message;prepared=null;}}
      finally {prepare.disabled=false;}
    });
    confirm.addEventListener('click',()=>{
      if(!prepared||confirm.disabled)return;
      const json=JSON.stringify(prepared),snapshotFile={name:file.name,size:new TextEncoder().encode(json).length,text:async()=>json};
      model.listId=select.value;model.search='';model.review='';dialog.remove();importFile(snapshotFile);
    });
  }
  function detail(id) {
    const r=model.rows.find(row=>row.id===id);if(!r)return;const raw=r.raw_record;
    const fields=(raw.custom_fields||[]).filter(f=>f.value!==undefined&&f.value!==null&&f.value!=='');
    const sourceUrl=/^https:\/\/app\.clickup\.com\/t\/[a-zA-Z0-9_-]+$/.test(r.source_record_url||'')?r.source_record_url:'';
    modal(raw.name,`${r.source_container_name} · ${raw.task_type||r.record_type}${raw.parent?' · Subtask':''}`,`<div class="source-record-meta"><b>${esc(r.validation_status)}</b><p>${esc(r.validation_notes||'')}</p>${sourceUrl?`<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open original in ClickUp</a>`:''}<p>Source ID: ${esc(r.source_record_id)}${raw.parent?` · Parent: ${esc(raw.parent)}`:''}</p></div>${raw.description?`<div class="source-description">${esc(raw.description)}</div>`:''}<table class="table source-detail-fields"><tbody>${fields.map(f=>`<tr><th>${esc(f.name)}</th><td>${esc(displayField(f))}</td></tr>`).join('')||'<tr><td>No populated custom fields.</td></tr>'}</tbody></table><div class="settings-note">Review status records a data check. Changing it does not create operational invoices, payments or revenue allocations.</div>`,`<button class="btn" data-close>Close</button>`);
  }
  async function saveReview(el,field) {
    const id=el.dataset.sourceReview||el.dataset.sourceNotes,value=el.value,row=model.rows.find(r=>r.id===id);if(!row)return;
    el.disabled=true;
    try {await request(`migration_staging?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({[field]:value}),headers:{Prefer:'return=minimal'}});row[field]=value;const item=model.index.find(r=>r.id===id);if(item&&field==='validation_status')item.validation_status=value;toast('Review saved');}
    catch(e){el.value=row[field]||'';model.error=`Review was not saved: ${e.message}`;render();}
    finally {el.disabled=false;}
  }
  function bind(root) {
    root.querySelector('[data-source-refresh]')?.addEventListener('click',()=>load(true));
    root.querySelector('[data-source-upload]')?.addEventListener('click',()=>root.querySelector('#source-file').click());
    root.querySelector('#source-file')?.addEventListener('change',e=>importFile(e.target.files[0]));
    root.querySelector('[data-source-csv]')?.addEventListener('click',()=>root.querySelector('#source-csv-file').click());
    root.querySelector('#source-csv-file')?.addEventListener('change',e=>previewCsv(e.target.files[0]));
    root.querySelectorAll('[data-source-list]').forEach(el=>el.addEventListener('click',()=>{model.listId=el.dataset.sourceList;model.page=0;load(false);}));
    root.querySelector('#source-review-filter')?.addEventListener('change',e=>{model.review=e.target.value;model.page=0;load(false);});
    root.querySelector('#source-search-form')?.addEventListener('submit',e=>{e.preventDefault();model.search=new FormData(e.currentTarget).get('query');model.page=0;load(false);});
    root.querySelector('[data-source-prev]')?.addEventListener('click',()=>{model.page--;load(false);});
    root.querySelector('[data-source-next]')?.addEventListener('click',()=>{model.page++;load(false);});
    root.querySelectorAll('[data-source-detail]').forEach(el=>el.addEventListener('click',()=>detail(el.dataset.sourceDetail)));
    root.querySelectorAll('[data-source-review]').forEach(el=>el.addEventListener('change',()=>saveReview(el,'validation_status')));
    root.querySelectorAll('[data-source-notes]').forEach(el=>el.addEventListener('change',()=>saveReview(el,'validation_notes')));
  }
  function focus(listId,query=''){model.listId=listId;model.search=query;model.page=0;model.review='';return load(true);}
  return {view,bind,load,importFile,focus};
}
