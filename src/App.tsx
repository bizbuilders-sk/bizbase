import { Component, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error This already-tested matcher remains JavaScript during the frontend migration.
import { findDuplicateCandidates } from '../duplicates-core.mjs';
import {
  Activity, ArrowDownUp, BriefcaseBusiness, Building2, ContactRound, LayoutDashboard,
  LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings2,
  X,
} from 'lucide-react';
import { connectionSource, getClient, readConnection, saveConnection } from './supabase';
import Workspace, { useModal } from './Workspace.tsx';
import {pageTitle, pageEntity} from './entity-presentation.ts';

type Page = 'Pipeline' | 'Projects' | 'Accounts & contacts' | 'Settings';
type Row = Record<string, unknown> & { id: string };

const nav: { label: Page; icon: typeof LayoutDashboard }[] = [
  { label: 'Accounts & contacts', icon: ContactRound },
  { label: 'Pipeline', icon: Activity },
  { label: 'Projects', icon: BriefcaseBusiness },
  { label: 'Settings', icon: Settings2 },
];

async function readEveryPage<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

const pageHash: Record<Page,string> = { Pipeline: 'pipeline', Projects: 'projects', 'Accounts & contacts': 'contacts', Settings: 'settings' };
const pageFromHash = (): Page => window.location.hash === '#accounts' ? 'Accounts & contacts' : (Object.keys(pageHash) as Page[]).find(page => `#${pageHash[page]}` === window.location.hash) || 'Accounts & contacts';

function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [session, setSession] = useState<Session | null>(null);
  const [client] = useState<SupabaseClient | null>(() => getClient());
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [membership, setMembership] = useState<'checking' | 'active' | 'denied' | 'error'>('checking');
  const searchRef = useRef<HTMLInputElement>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 680px)').matches);
  const sidebarRef = useModal(menuOpen && mobile, () => setMenuOpen(false));

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); }, () => setAuthReady(true));
    const { data } = client.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true); });
    return () => data.subscription.unsubscribe();
  }, [client]);

  const reload = () => setVersion((n) => n + 1);
  useEffect(() => { const query=window.matchMedia('(max-width: 680px)'); const change=()=>{setMobile(query.matches);if(!query.matches)setMenuOpen(false);};query.addEventListener('change',change);return()=>query.removeEventListener('change',change); }, []);

  useEffect(() => { const change = () => { setPage(pageFromHash()); setSearch(''); }; window.addEventListener('hashchange',change); return () => window.removeEventListener('hashchange',change); }, []);
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener('keydown',key); return () => window.removeEventListener('keydown',key); }, []);
  useEffect(() => { if (!client || !session) return; let active = true; setMembership('checking'); client.rpc('is_workspace_member').then(({ data,error }) => { if (active) setMembership(error ? 'error' : data ? 'active' : 'denied'); }, () => { if (active) setMembership('error'); }); return () => { active = false; }; }, [client,session?.user.id,version]);

  useEffect(() => {
    if (!session?.user.id) return;
    setSidebarCollapsed(localStorage.getItem(`bizbase:sidebar-collapsed:${session.user.id}`) === 'true');
  }, [session?.user.id]);

  if (!client) return <ConnectionScreen onSave={saveConnection} />;
  if (!authReady) return <div className="auth-screen" role="status">Opening BizBase…</div>;
  if (!session) return <SignInScreen client={client} notice={notice} />;
  if (membership === 'checking') return <div className="auth-screen" role="status">Checking workspace access…</div>;
  if (membership !== 'active') return <div className="auth-screen"><section className="auth-card"><h1>{membership === 'error' ? 'Couldn’t verify access' : 'Workspace access required'}</h1><p>{session.user.email}</p><p>{membership === 'error' ? 'Check your connection and try again.' : 'Your account needs an active BizBase workspace membership.'}</p><button className="button" onClick={reload}>Try again</button><button className="button" onClick={() => void client.auth.signOut()}>Sign out</button></section></div>;

  async function signOut() {
    await client?.auth.signOut();
    setSession(null);
  }

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (session?.user.id) localStorage.setItem(`bizbase:sidebar-collapsed:${session.user.id}`, String(next));
  }

  return <div data-entity={pageEntity(page)} className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside ref={sidebarRef} tabIndex={-1} inert={mobile&&!menuOpen} role={mobile&&menuOpen?'dialog':undefined} aria-modal={mobile&&menuOpen?true:undefined} aria-label="Workspace navigation" className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark">b</div><div><strong>BizBase</strong><span>BizBuilders workspace</span></div><button className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button><button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={17} /></button></div>
      <nav className="nav-list" aria-label="Main navigation">
        {nav.map((item) => <button key={item.label} className={`nav-item ${page === item.label ? 'active' : ''}`} aria-current={page===item.label?'page':undefined} onClick={() => { window.location.hash=pageHash[item.label]; setPage(item.label); setSearch(''); setMenuOpen(false); }} title={sidebarCollapsed ? pageTitle(item.label) : undefined}><item.icon size={17} strokeWidth={1.8} /><span>{pageTitle(item.label)}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="profile"><div className="avatar" title={session.user.email}>{session.user.email?.slice(0, 1).toUpperCase()}</div><span><strong>{session.user.email}</strong><small>Staff account</small></span><button className="icon-button" onClick={signOut} title="Sign out"><LogOut size={15} /></button></div></div>
    </aside>
    {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-trigger" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={19} /></button><h1 className="screen-title">{pageTitle(page)}</h1><div className="top-actions"><label className="global-search"><Search size={15} /><input ref={searchRef} aria-label="Search current view" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={event=>{if(event.key==='Escape')setSearch('');}} placeholder="Search current view" /><kbd>⌘ K</kbd></label></div></header>
      <div className="content">
        {notice && <div className="notice" role="status">{notice}<button className="icon-button" onClick={() => setNotice('')}><X size={14} /></button></div>}
        <section className="panel"><WorkspaceBoundary resetKey={`${page}:${version}`}><WorkspacePage page={page} client={client} userId={session.user.id} search={search} version={version} onChange={reload} onNotice={setNotice} /></WorkspaceBoundary></section>
        <footer className="page-footer"><span><span className="live-dot" /> Connected workspace</span><span>All values in EUR · Data sourced from Supabase</span></footer>
      </div>
    </main>
  </div>;
}

class WorkspaceBoundary extends Component<{children: ReactNode; resetKey: string},{failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: {resetKey: string}) { if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({failed:false}); }
  render() { return this.state.failed ? <div className="empty-state error-state" role="alert"><strong>Couldn’t open this view</strong><span>Retry to reopen the workspace.</span><button className="button" onClick={()=>this.setState({failed:false})}>Reopen workspace</button></div> : this.props.children; }
}

function WorkspacePage({ page, client, userId, search, version, onChange, onNotice }: { page: Page; client: SupabaseClient; userId: string; search: string; version: number; onChange: () => void; onNotice: (value: string) => void }) {
  if (page === 'Settings') return <SettingsPage />;
  return <Workspace client={client} userId={userId} page={page} search={search} version={version} notice={onNotice} duplicateReview={<DuplicateReviewPage client={client} version={version} search={search} onChange={onChange} onNotice={onNotice} />} />;
}

type DuplicateCandidate = { type: 'account' | 'contact'; left: Row; right: Row; score: number; reasons: string[] };
type DuplicateFilter = 'All' | 'Companies' | 'Contacts';

function DuplicateReviewPage({ client, version, search, onChange, onNotice }: { client: SupabaseClient; version: number; search: string; onChange: () => void; onNotice: (value: string) => void }) {
  const [filter, setFilter] = useState<DuplicateFilter>('All');
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisionsReady, setDecisionsReady] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DuplicateCandidate | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true; setLoading(true); setDecisionsReady(false); setError('');
    Promise.all([
      readEveryPage((from, to) => client.from('accounts').select('*').order('id').range(from, to)),
      readEveryPage((from, to) => client.from('contacts').select('*').order('id').range(from, to)),
      readEveryPage((from, to) => client.from('duplicate_review_decisions').select('entity_type,record_a_id,record_b_id').eq('disposition', 'Not a duplicate').order('id').range(from, to)),
    ]).then(([as, cs, decisions]) => {
      if (!active) return;
      setAccounts(as as unknown as Row[]);
      setDecisionsReady(true);
      const ignoreKeys = new Set((decisions || []).map((row) => `${row.entity_type}:${row.record_a_id}:${row.record_b_id}`));
      const found = findDuplicateCandidates(as, cs) as DuplicateCandidate[];
      setCandidates(found.filter((item) => !ignoreKeys.has(duplicateKey(item))));
      
      setLoading(false);
    }).catch((requestError: Error) => { if (active) { setError(requestError.message); setLoading(false); } });
    return () => { active = false; };
  }, [client, version]);

  const accountName = (id: unknown) => String(accounts.find((account) => account.id === id)?.name || 'Company not linked');
  const visible = candidates.filter((item) => (filter === 'All' || (filter === 'Companies' && item.type === 'account') || (filter === 'Contacts' && item.type === 'contact')) && JSON.stringify([item.left,item.right,item.reasons]).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const companyCount = candidates.filter((item) => item.type === 'account').length;
  const contactCount = candidates.filter((item) => item.type === 'contact').length;

  async function dismiss(item: DuplicateCandidate) {
    if (!decisionsReady || busy) return;
    setBusy(true); setError('');
    const [record_a_id, record_b_id] = [item.left.id, item.right.id].sort();
    try {
      const { error: saveError } = await client.from('duplicate_review_decisions').upsert({ entity_type: item.type, record_a_id, record_b_id, disposition: 'Not a duplicate' }, { onConflict: 'entity_type,record_a_id,record_b_id' });
      if (saveError) throw saveError;
      setCandidates((current) => current.filter((candidate) => duplicateKey(candidate) !== duplicateKey(item)));
      onNotice('Saved: these BizBase records will no longer be suggested as a match.');
    } catch (cause) { setError(`Could not save decision: ${(cause as Error).message}`); }
    finally { setBusy(false); }
  }

  async function merge(survivorId: string) {
    if (!selected || !decisionsReady || busy) return;
    const duplicateId = survivorId === selected.left.id ? selected.right.id : selected.left.id;
    setBusy(true); setError('');
    try {
      const { error: mergeError } = await client.rpc('merge_bizbase_records', { p_entity_type: selected.type, p_survivor_id: survivorId, p_duplicate_id: duplicateId });
      if (mergeError) throw mergeError;
      setSelected(null); onChange(); onNotice('BizBase records merged; ClickUp and Pipedrive were not changed.');
    } catch (cause) { setError(`Merge was not completed: ${(cause as Error).message}`); }
    finally { setBusy(false); }
  }

  return <div className="duplicate-page">
    <div className="duplicate-trust-note"><span>Suggestions from BizBase records · merges require review</span><button className="control-button" onClick={onChange}><ArrowDownUp size={13} /> Refresh</button></div>
    <div className="duplicate-metrics"><div><small>Possible matches</small><strong>{candidates.length}</strong><span>Awaiting review</span></div><div><small>Companies</small><strong>{companyCount}</strong><span>Name or website</span></div><div><small>Contacts</small><strong>{contactCount}</strong><span>Email, phone or same-company name</span></div></div>
    <div className="duplicate-filter-row"><div className="view-switch" role="tablist">{(['All', 'Companies', 'Contacts'] as const).map((option) => <button key={option} role="tab" aria-selected={filter === option} className={filter === option ? 'selected' : ''} onClick={() => setFilter(option)}>{option}</button>)}</div><span>{visible.length} to review</span></div>
    {error && <div className={`duplicate-alert ${decisionsReady ? '' : 'migration-alert'}`} role="status">{error}{!decisionsReady && <span> Apply <code>supabase/migrations/0004_duplicate_review_and_merge.sql</code> to enable saved decisions and merges.</span>}</div>}
    {loading && <div className="board-loading">Checking company and contact records…</div>}
    {!loading && !error && visible.length === 0 && <div className="duplicate-empty">{candidates.length ? 'No matches in this filter.' : 'No possible duplicates found.'}</div>}
    <div className="duplicate-candidate-list">{visible.map((item) => <article className="duplicate-candidate" key={duplicateKey(item)}><div className="candidate-top"><span className="candidate-kind">{item.type === 'account' ? <><Building2 size={13} /> Company</> : <><ContactRound size={13} /> Contact</>}</span><span className="candidate-score">{item.score}% match</span></div><div className="candidate-pair"><DuplicateRecord record={item.left} type={item.type} accountName={accountName} /><span className="candidate-versus">↔</span><DuplicateRecord record={item.right} type={item.type} accountName={accountName} /></div><div className="candidate-reasons">{item.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div><div className="candidate-actions"><button className="button button-quiet" disabled={!decisionsReady || busy} onClick={() => void dismiss(item)}>Not a duplicate</button><button className="button button-primary" disabled={!decisionsReady || busy} onClick={() => setSelected(item)}>Review merge</button></div></article>)}</div>
    {selected && <MergeDialog key={duplicateKey(selected)} candidate={selected} accountName={accountName} busy={busy} error={error} onClose={() => { if (!busy) { setSelected(null); setError(''); } }} onMerge={merge} />}
  </div>;
}

function duplicateKey(item: DuplicateCandidate) { const [a, b] = [item.left.id, item.right.id].sort(); return `${item.type}:${a}:${b}`; }
function DuplicateRecord({ record, type, accountName }: { record: Row; type: 'account' | 'contact'; accountName: (id: unknown) => string }) {
  const title = type === 'account' ? String(record.name || 'Unnamed company') : [record.first_name, record.last_name].filter(Boolean).join(' ') || String(record.email || 'Unnamed contact');
  const detail = type === 'account' ? [record.industry, record.company_size].filter(Boolean).join(' · ') || 'Company details not set' : accountName(record.account_id);
  const contactInfo = type === 'account' ? String(record.website || 'No website') : [record.email, record.phone].filter(Boolean).join(' · ') || 'No email or phone';
  return <div className="duplicate-record"><strong>{title}</strong><span>{detail}</span><span>{contactInfo}</span></div>;
}
function MergeDialog({ candidate, accountName, busy, error, onClose, onMerge }: { candidate: DuplicateCandidate; accountName: (id: unknown) => string; busy: boolean; error: string; onClose: () => void; onMerge: (survivorId: string) => Promise<void> }) {
  const [survivorId, setSurvivorId] = useState(candidate.left.id);
  const dialog = useModal(true, () => { if (!busy) onClose(); });
  const keys = candidate.type === 'account' ? ['name','kind','website','industry','company_size','qualification_status'] : ['first_name','last_name','email','phone','role_title','account_id'];
  const value = (row: Row,key: string) => key === 'account_id' ? accountName(row[key]) : String(row[key] || '—');
  return <div data-entity="contacts" className="merge-backdrop"><section ref={dialog} tabIndex={-1} className="merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-title"><div className="merge-head"><div><h2 id="merge-title">Merge {candidate.type === 'account' ? 'companies' : 'contacts'}</h2><p>Keep one record. Its populated values take priority.</p></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close merge"><X size={18}/></button></div><div className="merge-options">{[candidate.left,candidate.right].map(record=><label key={record.id} className={`merge-option ${survivorId===record.id?'chosen':''}`}><input type="radio" name="survivor" disabled={busy} checked={survivorId===record.id} onChange={()=>setSurvivorId(record.id)}/><span className="merge-option-main"><strong>{candidate.type==='account'?String(record.name):[record.first_name,record.last_name].filter(Boolean).join(' ')||String(record.email)}</strong><small>{String(record.source_external_id||'Manual').split(':')[0]}</small></span><span className="keep-label">Keep</span></label>)}</div><div className="merge-comparison"><table><thead><tr><th>Field</th><th>First record</th><th>Second record</th></tr></thead><tbody>{keys.map(key=><tr key={key}><th>{key==='account_id'?'Company':key.replaceAll('_',' ')}</th><td className={survivorId===candidate.left.id?'chosen-value':''}>{value(candidate.left,key)}</td><td className={survivorId===candidate.right.id?'chosen-value':''}>{value(candidate.right,key)}</td></tr>)}</tbody></table></div><div className="merge-warning">The other BizBase record is removed after its relationships are reassigned. The merge is recorded in history. ClickUp and Pipedrive are untouched.</div>{error&&<div className="auth-error" role="alert">{error}</div>}<div className="merge-actions"><button className="button button-quiet" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy} onClick={()=>void onMerge(survivorId)}>{busy?'Merging…':'Merge in BizBase'}</button></div></section></div>;
}

function SettingsPage() {
  const [connection,setConnection] = useState(readConnection()); const [error,setError] = useState(''); const source=connectionSource(); const locked=source!=='This browser';
  return <div className="settings-page"><div className="settings-copy"><h2>Workspace</h2><p>Staff sign-in · EUR · Europe/Bratislava</p></div><div className="integration-status"><div><strong>Supabase</strong><span>Connected workspace</span></div><div><strong>ClickUp</strong><span>Imported snapshots · source is read-only</span></div><div><strong>Pipedrive</strong><span>Imported snapshots · source is read-only</span></div><div><strong>SuperFaktura, Gmail, Calendar & FinStat</strong><span>Not connected</span></div></div><details className="connection-details"><summary>Connection settings</summary><p className="security-note">Configuration: {source}</p><label className="settings-field">Project URL<input disabled={locked} value={connection.url} onChange={event=>setConnection({...connection,url:event.target.value})}/></label><label className="settings-field">Publishable key<input disabled={locked} value={connection.key} onChange={event=>setConnection({...connection,key:event.target.value})}/></label>{!locked&&<button className="button" onClick={()=>{try{saveConnection(connection);}catch(cause){setError((cause as Error).message);}}}>Save connection</button>}{error&&<div className="auth-error" role="alert">{error}</div>}</details></div>;
}

function ConnectionScreen({ onSave }: { onSave: (connection: { url: string; key: string }) => void }) {
  const [connection, setConnection] = useState(readConnection()); const [error,setError]=useState('');
  return <div className="auth-screen"><form className="auth-card" onSubmit={(e) => { e.preventDefault(); try { onSave(connection); } catch (cause) { setError((cause as Error).message); } }}><div className="brand-mark auth-mark">b</div><div className="eyebrow">BIZBUILDERS.Sk</div><h1>Connect your workspace</h1><p>Enter the Supabase project URL and publishable key, or add them as environment variables in Cloudflare Pages.</p><label className="settings-field">Project URL<input required value={connection.url} onChange={(e) => setConnection({ ...connection, url: e.target.value })} /></label><label className="settings-field">Publishable / anon key<input required value={connection.key} onChange={(e) => setConnection({ ...connection, key: e.target.value })} /></label>{error&&<div className="auth-error" role="alert">{error}</div>}<button className="button button-primary">Save and continue</button></form></div>;
}
function SignInScreen({ client, notice }: { client: SupabaseClient; notice: string }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password }); if (authError) throw authError; } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <div className="auth-screen"><form className="auth-card" onSubmit={(e) => void submit(e)}><div className="brand-mark auth-mark">b</div><div className="eyebrow">BIZBUILDERS.SK</div><h1>Welcome back</h1><p>Sign in with your BizBuilders staff account.</p><label className="settings-field">Work email<input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label className="settings-field">Password<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error && <div className="auth-error">{error}</div>}{notice && <div className="auth-error">{notice}</div>}<button className="button button-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button><small>Access is limited to authorized workspace users.</small></form></div>;
}

export default App;
