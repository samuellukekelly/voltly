# Voltly (v26)

Next.js + Tailwind + Supabase (client-side) + PDF text extraction via PDF.js.

## Vercel env vars (required)
Set these in Vercel Project Settings → Environment Variables:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

## Supabase
For Region M, the app queries the view `v_tariff_compare_region_m`.

If you add other regions later, it will fall back to querying `tariff_rates` joined to `tariffs` and `providers`.

## Deploy
Push to GitHub, import into Vercel, set env vars, deploy.
