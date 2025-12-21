# Voltly

A simple, fully web-based bill upload + extraction MVP built with Next.js (App Router) and Tailwind.

## What it does
- Upload a **text-based** PDF bill (not scanned)
- Extracts a few key values (optimised for Octopus-style bills)
- Shows extracted values in a pop-out modal

## Deploy to Vercel (no local dev required)
1. Create a new GitHub repo and upload the contents of this zip.
2. In Vercel: **New Project** → import the repo.
3. Framework preset: **Next.js**
4. Build command: `next build` (default)
5. Output: handled by Next (default)

Vercel will run `postinstall`, which copies the PDF.js worker to `/public/pdf.worker.min.js`.
