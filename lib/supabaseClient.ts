import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Client-side Supabase client.
 * We return null if env vars are missing so the UI can show a friendly message
 * instead of crashing the build/prerender.
 */
export const supabase =
  url && anon ? createClient(url, anon, { auth: { persistSession: false } }) : null;
