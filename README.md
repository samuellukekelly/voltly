# Voltly

Fully web-based bill upload + extraction MVP (Next.js + Tailwind), built to deploy on **Vercel**.

## Why Vercel blocked your deploy
Vercel blocks **vulnerable Next.js versions** affected by CVE-2025-66478.  
Per Vercel’s bulletin, **Next.js 15.0.x must be >= 15.0.5**. citeturn2view0

This repo pins:
- `next`: **15.0.5**
- `eslint-config-next`: **15.0.5**

## Deploy
1. Upload to GitHub
2. Vercel → New Project → import → Deploy

## PDF Worker
`postinstall` copies PDF.js worker into `/public/pdf.worker.min.mjs` and the app points PDF.js to that file.
