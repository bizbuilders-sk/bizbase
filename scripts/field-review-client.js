const reviewData = JSON.parse(document.getElementById('review-data').textContent);
const storageKey = 'bizbase-simple-field-review-v2-20261104';
let reviewEdits = { fields: {}, questions: {} };
let storageWorks = true;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved && typeof saved === 'object' && saved.fields && saved.questions) reviewEdits = saved;
} catch { storageWorks = false; }
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const originalField = id => reviewData.fields.find(field => field.id === id);
const baseValue = (field, key) => key === 'note' ? field.userNote || '' : key === 'decision' && field.reviewQuestion ? 'Clarify display location' : field[key];
const currentField = field => ({ ...field, ...reviewEdits.fields[field.id] });
const inactiveDecision = decision => ['Card only', 'Remove from active use'].includes(decision);
const changedCount = () => Object.keys(reviewEdits.fields).length;

function updateStatus() {
  document.getElementById('save-status').textContent = (storageWorks ? 'Saved in this browser' : 'Browser saving unavailable — download your edits') + ' · ' + changedCount() + ' fields changed';
}
function saveEdits() {
  try { localStorage.setItem(storageKey, JSON.stringify(reviewEdits)); storageWorks = true; }
  catch { storageWorks = false; }
  updateStatus();
}
function setEdit(id, key, value) {
  const original = originalField(id);
  const patch = { ...reviewEdits.fields[id] };
  if (value === baseValue(original, key)) delete patch[key]; else patch[key] = value;
  if (Object.keys(patch).length) reviewEdits.fields[id] = patch; else delete reviewEdits.fields[id];
}
function booleanControl(field, key, label) {
  const value = field[key] === null ? '' : String(field[key]);
  const disabled = inactiveDecision(field.decision);
  return '<select data-property="' + key + '" aria-label="' + escapeHtml(label + ' for ' + field.label) + '" ' + (disabled ? 'disabled' : '') + '>' +
    [['', 'Clarify'], ['true', 'Yes'], ['false', 'No']].map(([v, text]) => '<option value="' + v + '" ' + ((disabled ? 'false' : value) === v ? 'selected' : '') + '>' + text + '</option>').join('') + '</select>';
}
function renderReview() {
  const opened = new Set([...document.querySelectorAll('details.entity[open]')].map(node => node.dataset.owner));
  const onlyChanges = document.getElementById('only-changes').checked;
  const owners = [...new Set(reviewData.fields.map(field => field.owner))];
  document.getElementById('field-sections').innerHTML = owners.map((owner, index) => {
    const fields = reviewData.fields.filter(field => field.owner === owner && (!onlyChanges || reviewEdits.fields[field.id]));
    if (!fields.length) return '';
    return '<details class="entity" data-owner="' + escapeHtml(owner) + '" ' + (opened.has(owner) || (!opened.size && index === 0) || onlyChanges ? 'open' : '') + '><summary>' + escapeHtml(owner) + ' <small>' + fields.length + ' fields</small></summary><div class="scroll"><table><thead><tr><th>Field name</th><th>Decision</th><th>Column</th><th>Filter</th><th>Group</th><th>Comment / context</th></tr></thead><tbody>' + fields.map(original => {
      const field = currentField(original);
      const decision = field.decision === original.decision && original.reviewQuestion && !reviewEdits.fields[field.id]?.decision ? 'Clarify display location' : field.decision;
      const options = [...new Set([decision, 'Keep', 'Card only', 'Remove from active use', 'Merge', 'Review'])];
      return '<tr data-id="' + escapeHtml(field.id) + '" class="' + (reviewEdits.fields[field.id] ? 'edited' : '') + '"><td><input data-property="label" aria-label="Field name for ' + escapeHtml(original.label) + '" value="' + escapeHtml(field.label) + '"></td><td><select data-property="decision" aria-label="Decision for ' + escapeHtml(field.label) + '">' + options.map(option => '<option ' + (option === decision ? 'selected' : '') + '>' + escapeHtml(option) + '</option>').join('') + '</select><small>' + escapeHtml(original.status) + '</small></td><td>' + booleanControl(field, 'column', 'Column') + '</td><td>' + booleanControl(field, 'filter', 'Filter') + '</td><td>' + booleanControl(field, 'group', 'Group') + '</td><td><textarea data-property="note" aria-label="Comment for ' + escapeHtml(field.label) + '" placeholder="Comment (optional)">' + escapeHtml(field.note ?? field.userNote ?? '') + '</textarea><details><summary>Context</summary><p><b>Origin:</b> ' + escapeHtml(field.origin) + '</p><p>' + escapeHtml(field.reason) + '</p><p><b>Examples:</b> ' + escapeHtml((field.samples || []).map(sample => typeof sample.value === 'object' ? JSON.stringify(sample.value) : sample.value).join(' · ') || 'No direct sample available') + '</p>' + (field.displays.length ? '<p><b>Linked displays (reference):</b></p><ul>' + field.displays.map(display => '<li>' + escapeHtml(display.screen) + ': ' + (/Remove|Move|History|Merge/.test(display.decision) ? 'no separate table display' : 'Column ' + (display.column ? 'Yes' : 'No') + ' · Filter ' + (display.filter ? 'Yes' : 'No') + ' · Group ' + (display.group ? 'Yes' : 'No')) + '</li>').join('') + '</ul>' : '') + '<small>Linked-display changes can be described in your comment.</small></details></td></tr>';
    }).join('') + '</tbody></table></div></details>';
  }).join('') || '<div class="panel">No edited fields yet.</div>';
  document.getElementById('finance-answer').value = reviewEdits.questions['financial-display'] || '';
  updateStatus();
}

document.getElementById('field-sections').addEventListener('input', event => {
  const property = event.target.dataset.property;
  if (!['label', 'note'].includes(property)) return;
  const row = event.target.closest('tr[data-id]');
  setEdit(row.dataset.id, property, event.target.value);
  row.classList.toggle('edited', Boolean(reviewEdits.fields[row.dataset.id]));
  saveEdits();
});
document.getElementById('field-sections').addEventListener('change', event => {
  if (event.target.tagName !== 'SELECT') return;
  const row = event.target.closest('tr[data-id]');
  const property = event.target.dataset.property;
  const value = ['column', 'filter', 'group'].includes(property) ? event.target.value === '' ? null : event.target.value === 'true' : event.target.value;
  setEdit(row.dataset.id, property, value);
  saveEdits();
  renderReview();
});
document.getElementById('finance-answer').addEventListener('change', event => {
  const answer = event.target.value;
  if (answer) reviewEdits.questions['financial-display'] = answer;
  else delete reviewEdits.questions['financial-display'];
  // Keep this answer separate from individual field decisions so a user can
  // specify mixed table layouts without a later answer erasing those edits.
  saveEdits();
});
document.getElementById('only-changes').addEventListener('change', renderReview);
document.getElementById('download-edits').addEventListener('click', () => {
  const invalidName = reviewData.fields.find(original => !String(currentField(original).label).trim());
  if (invalidName) {
    document.getElementById('save-status').textContent = 'Enter a field name before downloading: ' + invalidName.label;
    return;
  }
  const payload = {
    report: 'BizBase simplified field review', version: 2, sourceDate: reviewData.date,
    sourceWorkbook: reviewData.sourceWorkbook, exportedAt: new Date().toISOString(),
    state: 'Review instructions only; no changes applied to the app or database',
    questionAnswers: reviewEdits.questions,
    changes: Object.entries(reviewEdits.fields).map(([id, patch]) => {
      const original = originalField(id), field = currentField(original);
      return { id, owner: field.owner, changedProperties: patch,
        original: { label: original.label, decision: baseValue(original, 'decision'), column: original.column, filter: original.filter, group: original.group, note: baseValue(original, 'note') },
        requested: { label: field.label, decision: field.decision, column: inactiveDecision(field.decision) ? false : field.column, filter: inactiveDecision(field.decision) ? false : field.filter, group: inactiveDecision(field.decision) ? false : field.group, note: field.note ?? field.userNote ?? '' } };
    })
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'BizBase-field-review-edits.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
renderReview();
