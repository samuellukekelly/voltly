import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// IMPORTANT:
// - Do NOT throw at module-load time (it breaks Next.js prerender/build on Vercel).
// - If env vars are missing, `supabase` will be null and the UI will show a friendly message.
export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export const supabaseEnvOk = Boolean(supabaseUrl && supabaseAnonKey);
