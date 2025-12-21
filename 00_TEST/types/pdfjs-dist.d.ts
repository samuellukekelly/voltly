declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  // pdfjs-dist ships its own runtime types, but some bundlers/TS setups
  // don't pick them up for the legacy ESM build path.
  const pdfjsLib: any;
  export = pdfjsLib;
}
