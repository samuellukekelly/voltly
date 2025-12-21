import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const src = "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js";
const dest = "public/pdf.worker.min.js";

mkdirSync(dirname(dest), { recursive: true });

if (!existsSync(src)) {
  console.error("pdf.js worker not found at:", src);
  process.exit(0);
}

copyFileSync(src, dest);
console.log("Copied PDF.js worker to", dest);
