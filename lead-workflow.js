export function createLeadWorkflow({escape:esc,money,account,openReview}){
  function column(leads,query=''){
    const rows=(leads||[]).filter(l=>!l.promotedOpportunityId)
      .filter(l=>!query||`${l.name} ${l.contactName} ${l.email} ${account(l.accountId).name} ${l.sourceForm}`.toLowerCase().includes(query.toLowerCase()));
    const newCount=rows.filter(l=>l.journeyStatus==='New lead'||l.journeyStatus==='In review').length;
    return `<div class="board-col lead-stage"><div class="board-col-head"><strong>0 · New lead</strong><span>${newCount} to review · ${rows.length} retained</span></div><div class="lead-stage-note">Unqualified enquiries stay out of forecast totals.</div>${rows.length?rows.map(l=>`<article class="deal-card intake-card"><div class="intake-card-top"><span class="status-chip ${l.journeyStatus==='New lead'?'status-new':''}">${esc(l.journeyStatus||'New lead')}</span><span class="deal-owner">${esc(l.sourceForm||l.source||'Manual')}</span></div><h3>${esc(l.name||account(l.accountId).name)}</h3><p>${esc(account(l.accountId).name)}${l.contactName?` · ${esc(l.contactName)}`:''}</p><div class="intake-meta">${l.email?`<span>${esc(l.email)}</span>`:''}${l.submittedAt?`<time>${esc(new Date(l.submittedAt).toLocaleDateString('en-GB'))}</time>`:''}</div><button class="btn small" data-review-lead="${esc(l.id)}">Review & qualify</button></article>`).join(''):`<div class="empty">No unqualified leads</div>`}</div>`;
  }
  function bind(root){root.querySelectorAll('[data-review-lead]').forEach(x=>x.addEventListener('click',()=>openReview(x.dataset.reviewLead)))}
  return {column,bind};
}
