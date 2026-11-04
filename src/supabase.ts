import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const STORAGE_KEY = 'bizbase_connection';
export type Connection = { url: string; key: string };
type Config = { url?: string; key?: string };
// Publishable client configuration; access still requires staff Auth and RLS.
const DEFAULT_CONNECTION: Connection = { url: 'https://ydozgcgevccvduqotylv.supabase.co', key: 'sb_publishable_D7ApfUE6maT7zfnt6mOjXQ_6DRmev79' };

export function validateConnection(connection: Connection) {
  const url = new URL(connection.url);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Use an HTTPS Supabase project URL.');
  if (!connection.key.startsWith('sb_publishable_')) {
    let role = ''; try { role = JSON.parse(atob(connection.key.split('.')[1])).role; } catch { /* invalid key */ }
    if (role !== 'anon') throw new Error('Use a publishable or anon key. Secret and service-role keys cannot be used in BizBase.');
  }
}

export function connectionSource(): 'Cloudflare/Vite environment' | 'This browser' | 'BizBase workspace' {
  if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY) return 'Cloudflare/Vite environment';
  if (localStorage.getItem(STORAGE_KEY)) return 'This browser';
  return 'BizBase workspace';
}

export function readConnection(): Connection {
  const stored = localStorage.getItem(STORAGE_KEY);
  let saved: Config = {};
  try { saved = stored ? JSON.parse(stored) as Config : {}; } catch { /* ignore invalid local settings */ }
  return {
    url: import.meta.env.VITE_SUPABASE_URL || saved.url || DEFAULT_CONNECTION.url,
    key: import.meta.env.VITE_SUPABASE_ANON_KEY || saved.key || DEFAULT_CONNECTION.key,
  };
}

export function saveConnection(connection: Connection) {
  validateConnection(connection);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  window.location.reload();
}

export function getClient(): SupabaseClient | null {
  const { url, key } = readConnection();
  if (!url || !key) return null;
  try { validateConnection({url,key}); } catch { return null; }
  return createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
}
