import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
const candidates = [
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"
];
const dest = "public/pdf.worker.min.mjs";
mkdirSync(dirname(dest), { recursive: true });
const src = candidates.find(p => existsSync(p));
if (src) copyFileSync(src, dest);
