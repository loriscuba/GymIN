import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('✖  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti nel .env');
  process.exit(1);
}

// La service_role key bypassa RLS: il worker può leggere/scrivere tutte le tabelle.
export const supa = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
