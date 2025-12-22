import fs from "node:fs";
import path from "node:path";

const destDir = path.join(process.cwd(), "public");
const dest = path.join(destDir, "pdf.worker.min.mjs");

const candidates = [
  path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
  path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js"),
  path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.js"),
];

fs.mkdirSync(destDir, { recursive: true });

const found = candidates.find((p) => fs.existsSync(p));
if (!found) {
  console.warn("pdf.js worker not found at any known path. Checked:", candidates);
  process.exit(0);
}

fs.copyFileSync(found, dest);
console.log(`Copied PDF.js worker to public/${path.basename(dest)} from ${path.relative(process.cwd(), found)}`);
