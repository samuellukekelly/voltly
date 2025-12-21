# Voltly

Fully web-based bill upload + extraction MVP (Next.js + Tailwind).  
Designed to deploy cleanly on **Vercel**.

## What it does
- Upload a **text-based** PDF bill (not scanned)
- Extracts a few key values (optimised for Octopus-style bills)
- Shows extracted values in a pop-out modal

## Deploy (no local server required)
1. Upload this repo to GitHub
2. Vercel → New Project → import the repo → Deploy

### Notes
- Vercel runs `postinstall`, which copies PDF.js worker into `/public/pdf.worker.min.mjs`.
- The app then points PDF.js at `/pdf.worker.min.mjs` (same-origin = fewer CSP issues).
