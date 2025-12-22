import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Do NOT throw (would break prerender/build). Show UI error instead.
  if (!url || !anon) return null;

  cached = createClient(url, anon, {
    auth: { persistSession: false },
  });
  return cached;
}
