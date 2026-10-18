import {findDuplicateCandidates} from './duplicates-core.mjs';
const fullName = row => [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export function createDuplicates({request,connected,accounts,contacts,reload,render,pageHead,modal,toast,escape=esc}){
  const model={loading:false,error:'',busy:false,filter:'All',candidates:[],loaded:false,decisionsReady:false,ignored:new Set()};
  const accountName=id=>accounts().find(a=>a.id===id)?.name||'Unknown company';
  async function load(){
    if(!connected()){model.loaded=true;model.candidates=findDuplicateCandidates(accounts(),contacts());render();return;}
    model.loading=true;model.error='';render();
    try{
      const [as,cs]=await Promise.all([request('accounts?select=*'),request('contacts?select=*')]);
      try{const decisions=await request('duplicate_review_decisions?select=entity_type,record_a_id,record_b_id&disposition=eq.Not%20a%20duplicate');model.ignored=new Set(decisions.map(d=>`${d.entity_type}:${d.record_a_id}:${d.record_b_id}`));model.decisionsReady=true;}
      catch{model.decisionsReady=false;}
      model.candidates=findDuplicateCandidates(as,cs).filter(c=>!model.ignored.has(`${c.type}:${[c.left.id,c.right.id].sort()[0]}:${[c.left.id,c.right.id].sort()[1]}`));model.loaded=true;
    }catch(e){model.error=`Could not check for duplicates: ${e.message}`;}
    finally{model.loading=false;render();}
  }
  const visible=()=>model.candidates.filter(x=>model.filter==='All'||(model.filter==='Companies'&&x.type==='account')||(model.filter==='Contacts'&&x.type==='contact'));
  function mergeDialog(candidate){
    const isAccount=candidate.type==='account',a=candidate.left,b=candidate.right;
    const name=x=>isAccount?x.name:fullName(x)||x.email||'Unnamed contact';
    const side=(x,sideKey)=>`<label class="duplicate-choice"><input type="radio" name="duplicate-survivor" value="${escape(x.id)}" ${sideKey==='left'?'checked':''}><span class="duplicate-choice-body"><strong>${escape(name(x))}</strong><span>${isAccount?escape([x.industry,x.company_size].filter(Boolean).join(' · ')||'No company details'):escape(accountName(x.account_id))}</span><span>${isAccount?escape(x.website||'No website'):escape([x.email,x.phone].filter(Boolean).join(' · ')||'No email or phone')}</span></span><span class="duplicate-keep">Keep</span></label>`;
    const explanation=isAccount?'The chosen company record survives. The other company’s contacts, leads, opportunities, projects, invoices, notes, vendor links and source mappings are reassigned in BizBase. Matching contacts are consolidated; empty survivor fields are filled from the duplicate.':'The chosen contact survives. Related leads, opportunities and notes are reassigned in BizBase, and its empty fields are filled from the duplicate.';
    const dialog=modal('Merge duplicate records','Choose the BizBase record to keep.',`<div class="merge-explainer">${escape(explanation)}<br><b>ClickUp and Pipedrive are never changed.</b></div><div class="duplicate-choices">${side(a,'left')}${side(b,'right')}</div><div class="settings-note">This merge is recorded in BizBase’s merge history. The duplicate BizBase row will be removed after its linked records are reassigned.</div>`,`<button class="btn" data-close>Cancel</button><button class="btn primary" data-merge-confirm="${escape(candidate.type)}" data-merge-a="${escape(a.id)}" data-merge-b="${escape(b.id)}" ${model.decisionsReady?'':'disabled'}>Merge in BizBase</button>`);
    dialog?.querySelector('[data-merge-confirm]')?.addEventListener('click',async e=>{const btn=e.currentTarget,survivor=dialog.querySelector('input[name="duplicate-survivor"]:checked')?.value;if(!survivor)return;btn.disabled=true;dialog.remove();await merge(btn.dataset.mergeConfirm,btn.dataset.mergeA,btn.dataset.mergeB,survivor);});
  }
  async function merge(entityType,a,b,survivorId){
    if(!connected())throw Error('Connect Supabase to merge records.');
    const duplicateId=survivorId===a?b:a;
    model.busy=true;render();
    try{
      await request('rpc/merge_bizbase_records',{method:'POST',body:JSON.stringify({p_entity_type:entityType,p_survivor_id:survivorId,p_duplicate_id:duplicateId})});
      await reload();await load();toast('Records merged in BizBase. Source systems were not changed.');
    }catch(e){model.error=`Merge was not completed: ${e.message}`;render();}
    finally{model.busy=false;}
  }
  function view(){
    const rows=visible(),companies=model.candidates.filter(x=>x.type==='account').length,people=model.candidates.filter(x=>x.type==='contact').length;
    const filters=['All','Companies','Contacts'];
    return pageHead('Duplicate review','Review possible matches and decide which BizBase record to keep.',`<button class="btn" data-duplicates-refresh ${model.loading||model.busy?'disabled':''}>Check again</button>`)+
      `<div class="notice duplicate-notice"><span><b>${connected()?'BizBase records only':'Demo data only'}</b> · Matching is a suggestion. No record is merged automatically. ClickUp and Pipedrive stay untouched.${connected()&&!model.decisionsReady?' · Run the duplicate-review SQL migration to enable merge and saved review decisions.':''}</span></div>`+
      `<div class="stats duplicate-stats"><div class="stat"><div class="stat-top"><span>Possible matches</span></div><div class="stat-value">${model.candidates.length}</div><div class="stat-foot">Awaiting review</div></div><div class="stat"><div class="stat-top"><span>Companies</span></div><div class="stat-value">${companies}</div><div class="stat-foot">Matching name or website</div></div><div class="stat"><div class="stat-top"><span>Contacts</span></div><div class="stat-value">${people}</div><div class="stat-foot">Matching email, phone or same-company name</div></div></div>`+
      `<div class="toolbar duplicate-toolbar"><div class="tab-row">${filters.map(x=>`<button class="${model.filter===x?'active':''}" data-duplicate-filter="${x}">${x}</button>`).join('')}</div><span class="pill">${rows.length} to review</span></div>`+
      `${model.error?`<div class="source-error" role="alert">${escape(model.error)}</div>`:''}${model.loading?`<div class="card empty">Checking BizBase records…</div>`:''}`+
      `${!model.loading&&!rows.length?`<div class="card empty">${model.loaded?'No possible duplicates found.':'Connect Supabase to review shared records.'}</div>`:''}`+
      `<div class="duplicate-list">${rows.map(c=>{const isAccount=c.type==='account',label=x=>isAccount?x.name:fullName(x)||x.email||'Unnamed contact';return`<article class="card duplicate-card"><div class="duplicate-card-head"><span class="duplicate-type">${isAccount?'Company':'Contact'}</span><span class="match-score">${c.score}% match</span></div><div class="duplicate-pair"><div class="duplicate-record"><strong>${escape(label(c.left))}</strong><span>${isAccount?escape([c.left.industry,c.left.company_size].filter(Boolean).join(' · ')||'Company record'):escape(accountName(c.left.account_id))}</span><span>${escape(isAccount?c.left.website||'No website':[c.left.email,c.left.phone].filter(Boolean).join(' · ')||'No email or phone')}</span></div><div class="duplicate-vs">↔</div><div class="duplicate-record"><strong>${escape(label(c.right))}</strong><span>${isAccount?escape([c.right.industry,c.right.company_size].filter(Boolean).join(' · ')||'Company record'):escape(accountName(c.right.account_id))}</span><span>${escape(isAccount?c.right.website||'No website':[c.right.email,c.right.phone].filter(Boolean).join(' · ')||'No email or phone')}</span></div></div><div class="duplicate-reasons">${c.reasons.map(r=>`<span class="pill">${escape(r)}</span>`).join('')}</div><div class="duplicate-actions"><button class="btn small" data-dismiss-duplicate="${escape(c.type)}:${escape(c.left.id)}:${escape(c.right.id)}">Not a duplicate</button><button class="btn primary small" data-merge-open="${escape(c.type)}:${escape(c.left.id)}:${escape(c.right.id)}" ${connected()?'':'disabled'}>Review merge</button></div></article>`}).join('')}</div>`;
  }
  function bind(root){
    root.querySelector('[data-duplicates-refresh]')?.addEventListener('click',load);
    root.querySelectorAll('[data-duplicate-filter]').forEach(x=>x.addEventListener('click',()=>{model.filter=x.dataset.duplicateFilter;render();}));
    root.querySelectorAll('[data-merge-open]').forEach(x=>x.addEventListener('click',()=>{const [type,left,right]=x.dataset.mergeOpen.split(':');const c=model.candidates.find(y=>y.type===type&&y.left.id===left&&y.right.id===right);if(c)mergeDialog(c);}));
    root.querySelectorAll('[data-dismiss-duplicate]').forEach(x=>x.addEventListener('click',async()=>{const [type,left,right]=x.dataset.dismissDuplicate.split(':');if(!connected()||!model.decisionsReady){model.error='Connect Supabase and apply the duplicate-review SQL migration to save this decision.';render();return;}const [a,b]=[left,right].sort();try{await request('duplicate_review_decisions?on_conflict=entity_type,record_a_id,record_b_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({entity_type:type,record_a_id:a,record_b_id:b,disposition:'Not a duplicate'})});model.candidates=model.candidates.filter(y=>!(y.type===type&&[y.left.id,y.right.id].includes(left)&&[y.left.id,y.right.id].includes(right)));toast('Marked as not a duplicate.');render();}catch(e){model.error=`Could not save review decision: ${e.message}`;render();}}));
  }
  return {load,view,bind};
}
