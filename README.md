# Voltly

Fully web-based bill upload + extraction MVP (Next.js + Tailwind), built to deploy on **Vercel**.

## Deploy (no local server required)
1. Upload to GitHub
2. Vercel → New Project → import the repo → Deploy

### Why your last build failed
- TypeScript couldn't resolve `pdfjs-dist/legacy/build/pdf` (exports/types issue).
- This version imports `pdfjs-dist/legacy/build/pdf.mjs` and includes an ambient `types/pdfjs-dist.d.ts`.

### PDF Worker
Vercel runs `postinstall`, copying PDF.js worker into `/public/pdf.worker.min.mjs`,
and we point PDF.js to `/pdf.worker.min.mjs` (same-origin).
