"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";

type Extracted = {
  supplier?: string;
  accountNumber?: string;
  billReference?: string;
  period?: string;
    periodDays?: number;
postcodeAlpha?: string; // region code alpha (A–P) e.g. "M"
  tariffName?: string;
  paymentMethod?: string;

  electricityDayRateP?: number;
  electricityNightRateP?: number;
  electricityStandingPPerDay?: number;

  electricDayKwh?: number;
  electricNightKwh?: number;
  electricTotalKwh?: number;
  gasUnitRateP?: number;
  gasStandingPPerDay?: number;
  gasTotalKwh?: number;

  gasEstimatedAnnualGBP?: number;
  electricityEstimatedAnnualGBP?: number;

  notes: string[];
  rawTextSample?: string;
};

type CompareRow = {
  provider_code: string;
  provider_name: string;
  tariff_name: string;
  tariff_type: string | null;
  term_months: number | null;
  end_date: string | null;
  region_code: string;
  electricity_unit_rate_p_per_kwh: number;
  electricity_standing_charge_p_per_day: number;
  gas_unit_rate_p_per_kwh: number;
  gas_standing_charge_p_per_day: number;
  exit_fees_total_gbp: number;
  last_updated: string | null;
};

type ProviderSummary = {
  providerCode: string;
  providerName: string;
  cheapest: Quote | null;
};

type Quote = {
  providerCode: string;
  providerName: string;
  tariffName: string;
  tariffType?: string | null;
  regionCode: string;

  elecUnitP: number;
  elecStandingPPerDay: number;
  gasUnitP: number;
  gasStandingPPerDay: number;

  estimatedAnnualElectricityGBP: number | null;
  estimatedAnnualGasGBP: number | null;
  estimatedAnnualTotalGBP: number | null;

  exitFeesTotalGBP: number;
  lastUpdated?: string | null;
};

function clampText(s: string, max = 1200) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}



function parseUKDateLoose(input: string): Date | null {
  const s = input.replace(/,/g, "").trim();

  // Try formats like: 01/10/2025
  const m1 = s.match(/^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{2,4})$/);
  if (m1) {
    const d = Number(m1[1]);
    const mo = Number(m1[2]) - 1;
    const y = Number(m1[3].length === 2 ? "20" + m1[3] : m1[3]);
    const dt = new Date(Date.UTC(y, mo, d));
    return Number.isFinite(dt.getTime()) ? dt : null;
  }

  // Try formats like: 1st Oct 2025, 1 Oct 2025, 01 Oct. 2025
  const m2 = s.match(/^([0-9]{1,2})(?:st|nd|rd|th)?\s+(\w+)\.?\s+([0-9]{4})$/i);
  if (m2) {
    const d = Number(m2[1]);
    const mon = m2[2].toLowerCase();
    const y = Number(m2[3]);
    const months: Record<string, number> = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11,
    };
    const key = Object.keys(months).find((k) => mon.startsWith(k));
    if (key == null) return null;
    const dt = new Date(Date.UTC(y, months[key], d));
    return Number.isFinite(dt.getTime()) ? dt : null;
  }

  return null;
}

function daysBetweenInclusiveUTC(a: Date, b: Date): number {
  const ms = 24 * 60 * 60 * 1000;
  const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  const diff = Math.round((end - start) / ms);
  return diff >= 0 ? diff + 1 : 0;
}

function parsePeriodDays(period?: string): number | null {
  if (!period) return null;
  // Example: "1st Oct 2025 - 31st Oct 2025"
  const m = period.match(/([0-9]{1,2}(?:st|nd|rd|th)?\s+\w+\.?\s+[0-9]{4})\s*[-–]\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+\w+\.?\s+[0-9]{4})/i);
  if (m) {
    const a = parseUKDateLoose(m[1]);
    const b = parseUKDateLoose(m[2]);
    if (a && b) return daysBetweenInclusiveUTC(a, b);
  }
  // Try dd/mm/yyyy - dd/mm/yyyy
  const m2 = period.match(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})\s*[-–]\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/);
  if (m2) {
    const a = parseUKDateLoose(m2[1]);
    const b = parseUKDateLoose(m2[2]);
    if (a && b) return daysBetweenInclusiveUTC(a, b);
  }
  return null;
}



function numFromMatch(m?: RegExpMatchArray | null) {
  if (!m || !m[1]) return undefined;
  const v = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(v) ? v : undefined;
}

function parseVoltlyFromText(text: string): Extracted {
  const notes: string[] = [];
  // Normalise common PDF text quirks (non‑breaking spaces, split units like "k W h").
  // This improves regex matching for kWh/£/p values extracted via pdf.js.
  const t = String(text)
    .replace(/\u00a0/g, " ")
    .replace(/k\s*w\s*h/gi, "kWh")
    .replace(/\s+/g, " ");

  // Number capture used in several patterns (allows thousands separators).
  const NUM = "([0-9][0-9,]*\\.?[0-9]*)";

  const supplier = /Octopus Energy/i.test(t) ? "Octopus Energy" : undefined;
  if (!supplier) notes.push("Supplier not confidently detected (parser optimised for Octopus-style bills).");

  const accountNumber = (t.match(/Your Account Number:\s*([A-Z0-9-]+)/i) || [])[1];
  const billReference = (t.match(/Bill Reference:\s*([0-9]+)/i) || [])[1];

  const electricityEstimatedAnnualGBP = numFromMatch(t.match(new RegExp(`£\\s*${NUM}\\s*a year for electricity`, "i")));
  const gasEstimatedAnnualGBP = numFromMatch(t.match(new RegExp(`£\\s*${NUM}\\s*a year for gas`, "i")));

  const period = (t.match(/Your energy account\s*([0-9]{1,2}[a-z]{2}\s+\w+\.?\s+\d{4}\s*-\s*[0-9]{1,2}[a-z]{2}\s+\w+\.?\s+\d{4})/i) || [])[1];
  const postcodeAlpha = (t.match(/Postcode area alpha identifier:\s*([A-Z]+)/i) || [])[1];

  const tariffName = (t.match(/Tariff Name\s*([A-Za-z0-9\s-]+)/i) || [])[1]?.trim();
  const paymentMethod = (t.match(/Payment Method\s*([A-Za-z\s-]+)/i) || [])[1]?.trim();

  const electricityDayRateP =
    numFromMatch(t.match(new RegExp(`Unit Rate\\s*\\(Day\\)\\s*${NUM}p\\s*per\\s*kWh`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Electricity\\s*Unit Rate\\s*${NUM}p\\s*per\\s*kWh`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Unit Rate\\s*${NUM}p\\s*per\\s*kWh[\\s\\S]{0,60}Electricity`, "i")));

  const electricityNightRateP = numFromMatch(t.match(new RegExp(`Unit Rate\\s*\\(Night\\)\\s*${NUM}p\\s*per\\s*kWh`, "i")));
  const electricityStandingPPerDay =
    numFromMatch(t.match(new RegExp(`Electricity\\s*Standing Charge\\s*${NUM}p\\s*\\/\\s*day`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Standing Charge\\s*${NUM}p\\s*\\/\\s*day[\\s\\S]{0,60}Electricity`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Standing Charge\\s*${NUM}p\\s*\\/\\s*day`, "i")));

  // Consumption (kWh) — try to capture totals, not "average daily".
  let electricNightKwh =
    numFromMatch(t.match(new RegExp(`(?:Night\\s*(?:consumption|usage)|Consumption\\s*Night|Night\\s*kWh)\\s*[: ]\\s*${NUM}\\s*kWh`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Night\\s*${NUM}\\s*kWh`, "i")));
  let electricDayKwh =
    numFromMatch(t.match(new RegExp(`(?:Day(?:time)?\\s*(?:consumption|usage)|Consumption\\s*Day|Day\\s*kWh)\\s*[: ]\\s*${NUM}\\s*kWh`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Day\\s*${NUM}\\s*kWh`, "i")));

  let electricTotalKwh =
    numFromMatch(t.match(new RegExp(`Total\\s*(?:electricity\\s*)?consumption\\s*${NUM}\\s*kWh`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Electricity\\s*consumption\\s*${NUM}\\s*kWh`, "i")));

  if (!electricDayKwh || !electricNightKwh) {
    // Some bills present a rate+kWh table (e.g. "Day 28.11p 123 kWh £34.58").
    // We'll pull table-like rows and match kWh to the detected day/night rates.
    type RateRow = { label?: "day" | "night"; rateP?: number; kwh?: number };
    const rows: RateRow[] = [];

    const pushRow = (label: "day" | "night" | undefined, rateP: number | undefined, kwh: number | undefined) => {
      if (!rateP && !kwh) return;
      rows.push({ label, rateP, kwh });
    };

    // Labeled formats (day/night/off-peak)
    for (const m of t.matchAll(new RegExp(`\\b(Day|Night|Off[-\\s]?peak|Peak)\\b[\\s\\S]{0,60}?${NUM}\\s*p(?:\\s*per\\s*kWh)?[\\s\\S]{0,60}?${NUM}\\s*kWh`, "gi"))) {
      const rawLabel = (m[1] || "").toLowerCase();
      const label = rawLabel.includes("night") || rawLabel.includes("off") ? "night" : rawLabel.includes("day") || rawLabel.includes("peak") ? "day" : undefined;
      const rateP = numFromMatch([m[2]]);
      const kwh = numFromMatch([m[3]]);
      pushRow(label as any, rateP ?? undefined, kwh ?? undefined);
    }

    // Unlabeled "rate then kWh" pairs; try to infer label from nearby words.
    for (const m of t.matchAll(new RegExp(`${NUM}\\s*p(?:\\s*per\\s*kWh)?[\\s\\S]{0,40}?${NUM}\\s*kWh`, "gi"))) {
      const rateP = numFromMatch([m[1]]);
      const kwh = numFromMatch([m[2]]);
      const aroundStart = Math.max(0, m.index! - 30);
      const aroundEnd = Math.min(t.length, m.index! + (m[0]?.length || 0) + 30);
      const around = t.slice(aroundStart, aroundEnd).toLowerCase();
      let label: "day" | "night" | undefined = undefined;
      if (around.includes("night") || around.includes("off-peak") || around.includes("off peak")) label = "night";
      if (around.includes("day") || around.includes("peak")) label = "day";
      pushRow(label, rateP ?? undefined, kwh ?? undefined);
    }

    const matchByRate = (targetRateP?: number | null, preferredLabel?: "day" | "night") => {
      if (!targetRateP) return null;
      let best: { row: RateRow; score: number } | null = null;
      for (const r of rows) {
        if (r.kwh == null || r.rateP == null) continue;
        // score: rate closeness + label bonus
        const d = Math.abs(r.rateP - targetRateP);
        let score = d;
        if (preferredLabel && r.label === preferredLabel) score -= 0.2;
        if (best == null || score < best.score) best = { row: r, score };
      }
      return best?.row ?? null;
    };

    if (!electricDayKwh && electricityDayRateP) {
      const r = matchByRate(electricityDayRateP, "day") || rows.find((x) => x.label === "day" && x.kwh != null);
      if (r?.kwh != null) electricDayKwh = r.kwh;
    }
    if (!electricNightKwh && electricityNightRateP) {
      const r = matchByRate(electricityNightRateP, "night") || rows.find((x) => x.label === "night" && x.kwh != null);
      if (r?.kwh != null) electricNightKwh = r.kwh;
    }

    if (!electricTotalKwh && (electricDayKwh || electricNightKwh)) {
      electricTotalKwh = (electricDayKwh || 0) + (electricNightKwh || 0);
    }
  }

  // Gas (best-effort)
  const gasUnitRateP =
    numFromMatch(t.match(new RegExp(`Gas\\s*Unit Rate\\s*${NUM}p\\s*per\\s*kWh`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Unit Rate\\s*\\(Gas\\)\\s*${NUM}p\\s*per\\s*kWh`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Unit Rate\\s*${NUM}p\\s*per\\s*kWh[\\s\\S]{0,60}Gas`, "i")));

  const gasStandingPPerDay =
    numFromMatch(t.match(new RegExp(`Gas\\s*Standing Charge\\s*${NUM}p\\s*\\/\\s*day`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Standing Charge\\s*${NUM}p\\s*\\/\\s*day[\\s\\S]{0,60}Gas`, "i")));

  const gasTotalKwh =
    numFromMatch(t.match(new RegExp(`Total\\s*gas\\s*(?:consumption|usage)\\s*${NUM}\\s*kWh`, "i"))) ??
    numFromMatch(t.match(new RegExp(`Gas\\s*(?:consumption|usage)\\s*${NUM}\\s*kWh`, "i")));

  const periodDays = parsePeriodDays(period);

  if (!electricityDayRateP && !electricityNightRateP) {
    notes.push("Could not find electricity unit rate(s). The bill may be scanned or formatted differently.");
  }
  if (!electricityStandingPPerDay) {
    notes.push("Could not find electricity standing charge.");
  }
  if (!electricTotalKwh) {
    notes.push("Could not confidently extract electricity kWh usage for the bill period.");
  }

  if (!gasUnitRateP) {
    notes.push("Could not find gas unit rate (if your PDF includes gas, try a clearer copy).");
  }
  if (!gasStandingPPerDay) {
    notes.push("Could not find gas standing charge (if your PDF includes gas, try a clearer copy).");
  }
  if (!gasTotalKwh) {
    // only note if we detected any gas pricing signals
    if (gasUnitRateP != null || gasStandingPPerDay != null || /\bGas\b/i.test(t)) {
      notes.push("Could not confidently extract gas kWh usage for the bill period.");
    }
  }


  return {
    supplier,
    accountNumber,
    billReference,
    period,
    postcodeAlpha,
    tariffName,
    paymentMethod,
    electricityDayRateP,
    electricityNightRateP,
    electricityStandingPPerDay,
    periodDays: periodDays ?? undefined,

    electricDayKwh: electricDayKwh,
    electricNightKwh: electricNightKwh,
    electricTotalKwh: electricTotalKwh,

    gasUnitRateP,
    gasStandingPPerDay,
    gasTotalKwh,

    gasEstimatedAnnualGBP,
    electricityEstimatedAnnualGBP,
    notes,
    rawTextSample: clampText(t, 900),
  };
}

async function loadPdfDoc(file: File): Promise<any> {
  const arrayBuffer = await file.arrayBuffer();

  // Dynamic import to keep server build happy.
  // pdfjs-dist >=4 ships ESM modules.
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");

  // Use same-origin worker copied to /public during postinstall.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  return pdf;
}

async function extractTextFromPdfDoc(pdf: any): Promise<string> {
  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent({ disableCombineTextItems: false });
    const strings = (content.items || [])
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);
    fullText += strings.join(" ") + "\n";
  }
  return fullText;
}

async function ocrTextFromPdfDoc(pdf: any, pageIndices: number[]): Promise<string> {
  // Client-side OCR fallback (only used when text parsing fails).
  // Note: keep this dynamic so it doesn't bloat the initial bundle.
  const { createWorker } = await import("tesseract.js");

  const worker = await createWorker("eng");
  try {    let out = "";
    for (const pageIndex of pageIndices) {
      const pageNum = pageIndex + 1;
      if (pageNum < 1 || pageNum > pdf.numPages) continue;

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const dataUrl = canvas.toDataURL("image/png");
      const res = await worker.recognize(dataUrl);
      out += (res?.data?.text || "") + "\n";
    }

    return out;
  } finally {
    try {
      await worker.terminate();
    } catch {
      // ignore
    }
  }


}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  const pdf = await loadPdfDoc(file);
  return extractTextFromPdfDoc(pdf);
}


function formatGBP(g?: number | null) {
  if (g == null || !Number.isFinite(g)) return "—";
  return `£${g.toFixed(2)}`;
}
function formatPence(p?: number | null) {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p.toFixed(2)}p`;
}

function calcAnnualFromRateP(unitP: number | null, standingPPerDay: number | null, annualKwh: number | null): number | null {
  if (unitP == null || standingPPerDay == null || annualKwh == null) return null;
  const u = (unitP / 100) * annualKwh;
  const s = (standingPPerDay / 100) * 365;
  const v = u + s;
  return Number.isFinite(v) ? v : null;
}


function calcPeriodFromRateP(unitP: number | null, standingPPerDay: number | null, periodKwh: number | null, days: number | null): number | null {
  if (unitP == null || standingPPerDay == null || periodKwh == null || days == null) return null;
  const u = (unitP / 100) * periodKwh;
  const s = (standingPPerDay / 100) * days;
  const v = u + s;
  return Number.isFinite(v) ? v : null;
}

function calcPeriodElecDayNight(
  dayP: number | null,
  nightP: number | null,
  standingPPerDay: number | null,
  dayKwh: number | null,
  nightKwh: number | null,
  totalKwh: number | null,
  days: number | null
): number | null {
  if (standingPPerDay == null || days == null) return null;
  const s = (standingPPerDay / 100) * days;

  // If we have day/night kWh and rates, use them. Otherwise fall back to total + best available rate.
  if (dayP != null && nightP != null && dayKwh != null && nightKwh != null) {
    const u = (dayP / 100) * dayKwh + (nightP / 100) * nightKwh;
    const v = u + s;
    return Number.isFinite(v) ? v : null;
  }

  const unitP = dayP ?? nightP ?? null;
  return calcPeriodFromRateP(unitP, standingPPerDay, totalKwh, days);
}


function deltaPill(delta: number | null) {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.005) return { label: "Same", kind: "neutral" as const };
  if (delta < 0) return { label: `Save ${formatGBP(Math.abs(delta))}`, kind: "good" as const };
  return { label: `+${formatGBP(delta)}`, kind: "bad" as const };
}

export default function VoltlyLanding() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [usedOcrFallback, setUsedOcrFallback] = useState(false);

  // Supabase compare state
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  const regionCode = useMemo(() => (extracted?.postcodeAlpha || "M").toUpperCase(), [extracted]);

  const onPick = () => fileRef.current?.click();

  const onFile = async (f?: File | null) => {
    setErr(null);
    setFilename(f?.name ?? null);
    setExtracted(null);
    setUsedOcrFallback(false);

    if (!f) return;

    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const isImage = f.type.startsWith("image/");

    setBusy(true);
    try {
      if (isPdf) {
        const pdf = await loadPdfDoc(f);

        // 1) Try normal (selectable text) extraction first.
        let text = await extractTextFromPdfDoc(pdf);
        let parsed = parseVoltlyFromText(text);

        // 2) OCR fallback if consumption (kWh) didn't come through (common when tables are fragmented).
        const missingConsumption =
          parsed.electricDayKwh == null &&
          parsed.electricNightKwh == null &&
          parsed.electricTotalKwh == null &&
          parsed.gasTotalKwh == null;

        const looksEmpty = text.replace(/\s+/g, " ").trim().length < 200;

        if (missingConsumption || looksEmpty) {
          const maxPages = Math.min(3, pdf.numPages);
          const pageIndices = Array.from({ length: maxPages }, (_, i) => i);
          const ocrText = await ocrTextFromPdfDoc(pdf, pageIndices);

          if (ocrText && ocrText.trim().length > 0) {
            text = text + "\n" + ocrText;
            parsed = parseVoltlyFromText(text);
            setUsedOcrFallback(true);
          }
        }

        setExtracted(parsed);
        setOpen(true);
      } else if (isImage) {
        // OCR fallback for photos/scans (best effort)
        const dataUrl = await fileToDataUrl(f);
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng");
        try {          const res = await worker.recognize(dataUrl);
          const ocrText = (res?.data?.text || "").trim();

          if (!ocrText) {
            setErr("I couldn’t extract any readable text from that image. Please try a clearer photo or upload the original PDF.");
            return;
          }

          setUsedOcrFallback(true);

          const parsed = parseVoltlyFromText(ocrText);
          setExtracted(parsed);
          setOpen(true);
        } finally {
          try {
            await worker.terminate();
          } catch {
            // ignore
          }
        }
      } else {
        setErr("Unsupported file type. Please upload a PDF bill.");
      }
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "Unknown error";
      setErr("Sorry — I couldn’t read that PDF. Details: " + msg);
    } finally {
      setBusy(false);
    }
  };

  // Load compare data when modal opens + we have extraction
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!open || !extracted) return;

      setProvidersLoading(true);
      setProvidersError(null);
      setCompareRows([]);

      const sb = getSupabaseClient();
      if (!sb) {
        setProvidersLoading(false);
        setProvidersError("Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel Environment Variables.");
        return;
      }

      try {
        // Prefer the view for Region M; for other regions use the join.
        if (regionCode === "M") {
          const { data, error } = await sb
            .from("v_tariff_compare_region_m")
            .select("*")
            .order("provider_name", { ascending: true })
            .order("tariff_name", { ascending: true });

          if (error) throw error;
          if (!cancelled) setCompareRows((data as any as CompareRow[]) || []);
        } else {
          // Generic path: tariff_rates -> tariffs -> providers, filtered by region.
          const { data, error } = await sb
            .from("tariff_rates")
            .select(`
              region_code,
              electricity_unit_rate_p_per_kwh,
              electricity_standing_charge_p_per_day,
              gas_unit_rate_p_per_kwh,
              gas_standing_charge_p_per_day,
              last_updated,
              tariffs:tariffs!inner(
                id,
                tariff_name,
                tariff_type,
                term_months,
                end_date,
                exit_fee_total_gbp,
                exit_fee_electricity_gbp,
                exit_fee_gas_gbp,
                providers:providers!inner(
                  provider_code,
                  provider_name
                )
              )
            `)
            .eq("region_code", regionCode);

          if (error) throw error;

          const rows: CompareRow[] = (data || []).map((r: any) => {
            const t = r.tariffs;
            const p = t?.providers;
            const exitFees =
              Number(t?.exit_fee_total_gbp || 0) + Number(t?.exit_fee_electricity_gbp || 0) + Number(t?.exit_fee_gas_gbp || 0);

            return {
              provider_code: p?.provider_code,
              provider_name: p?.provider_name,
              tariff_name: t?.tariff_name,
              tariff_type: t?.tariff_type ?? null,
              term_months: t?.term_months ?? null,
              end_date: t?.end_date ?? null,
              region_code: r.region_code,
              electricity_unit_rate_p_per_kwh: Number(r.electricity_unit_rate_p_per_kwh),
              electricity_standing_charge_p_per_day: Number(r.electricity_standing_charge_p_per_day),
              gas_unit_rate_p_per_kwh: Number(r.gas_unit_rate_p_per_kwh),
              gas_standing_charge_p_per_day: Number(r.gas_standing_charge_p_per_day),
              exit_fees_total_gbp: Number(exitFees),
              last_updated: r.last_updated ?? null,
            } as CompareRow;
          });

          if (!cancelled) setCompareRows(rows);
        }
      } catch (e: any) {
        const msg = e?.message || "Unknown error";
        if (!cancelled) setProvidersError(`Could not load suppliers from Supabase. ${msg}`);
      } finally {
        if (!cancelled) setProvidersLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, extracted, regionCode]);

  const yourAnnualElectricity = useMemo(() => {
    if (!extracted) return null;

    const days = extracted.periodDays ?? parsePeriodDays(extracted.period) ?? null;

    const totalKwh = (() => {
      const t = extracted.electricTotalKwh;
      if (t != null) return t;
      const d = (extracted.electricDayKwh || 0) + (extracted.electricNightKwh || 0);
      return d || null;
    })();

    return calcPeriodElecDayNight(
      extracted.electricityDayRateP ?? null,
      extracted.electricityNightRateP ?? null,
      extracted.electricityStandingPPerDay ?? null,
      extracted.electricDayKwh ?? null,
      extracted.electricNightKwh ?? null,
      totalKwh,
      days
    );
  }, [extracted]);

  const yourPeriodGas = useMemo(() => {
    if (!extracted) return null;
    const days = extracted.periodDays ?? parsePeriodDays(extracted.period) ?? null;
    return calcPeriodFromRateP(extracted.gasUnitRateP ?? null, extracted.gasStandingPPerDay ?? null, extracted.gasTotalKwh ?? null, days);
  }, [extracted]);

  const yourPeriodTotal = useMemo(() => {
    if (!extracted) return null;
    const e = yourAnnualElectricity;
    const g = yourPeriodGas;
    if (e == null && g == null) return null;
    return (e || 0) + (g || 0);
  }, [extracted, yourAnnualElectricity, yourPeriodGas]);


  const quotes: Quote[] = useMemo(() => {
    if (!extracted) return [];

        const days = extracted.periodDays ?? parsePeriodDays(extracted.period) ?? null;

    const periodElecKwh = (() => {
      const t = extracted.electricTotalKwh;
      if (t != null) return t;
      const d = (extracted.electricDayKwh || 0) + (extracted.electricNightKwh || 0);
      return d || null;
    })();

    const periodGasKwh = extracted.gasTotalKwh ?? null;
return compareRows.map((r) => {
      const estElec = calcPeriodFromRateP(r.electricity_unit_rate_p_per_kwh, r.electricity_standing_charge_p_per_day, periodElecKwh, days);
      const estGas = calcPeriodFromRateP(r.gas_unit_rate_p_per_kwh, r.gas_standing_charge_p_per_day, periodGasKwh, days);
      const total = estElec != null && estGas != null ? estElec + estGas : estElec;

      return {
        providerCode: r.provider_code,
        providerName: r.provider_name,
        tariffName: r.tariff_name,
        tariffType: r.tariff_type,
        regionCode: r.region_code,

        elecUnitP: r.electricity_unit_rate_p_per_kwh,
        elecStandingPPerDay: r.electricity_standing_charge_p_per_day,
        gasUnitP: r.gas_unit_rate_p_per_kwh,
        gasStandingPPerDay: r.gas_standing_charge_p_per_day,

        estimatedAnnualElectricityGBP: estElec,
        estimatedAnnualGasGBP: estGas,
        estimatedAnnualTotalGBP: total,

        exitFeesTotalGBP: r.exit_fees_total_gbp,
        lastUpdated: r.last_updated,
      };
    });
  }, [compareRows, extracted]);

  const providerSummaries: ProviderSummary[] = useMemo(() => {
    const byProvider = new Map<string, Quote[]>();
    for (const q of quotes) {
      if (!q.providerCode) continue;
      const arr = byProvider.get(q.providerCode) ?? [];
      arr.push(q);
      byProvider.set(q.providerCode, arr);
    }

    const out: ProviderSummary[] = [];
    for (const [providerCode, arr] of byProvider.entries()) {
      const providerName = arr[0]?.providerName ?? providerCode;

      // pick cheapest by estimatedAnnualTotalGBP (nulls last)
      const sorted = [...arr].sort((a, b) => {
        const av = a.estimatedAnnualTotalGBP ?? Number.POSITIVE_INFINITY;
        const bv = b.estimatedAnnualTotalGBP ?? Number.POSITIVE_INFINITY;
        return av - bv;
      });
      out.push({ providerCode, providerName, cheapest: sorted[0] ?? null });
    }

    return out.sort((a, b) => a.providerName.localeCompare(b.providerName));
  }, [quotes]);

  const bestOverall = useMemo(() => {
    const all = quotes.filter((q) => q.estimatedAnnualTotalGBP != null);
    if (!all.length) return null;
    return [...all].sort((a, b) => (a.estimatedAnnualTotalGBP! - b.estimatedAnnualTotalGBP!))[0];
  }, [quotes]);

  const [selectedProviderCode, setSelectedProviderCode] = useState<string | null>(null);
  const selectedProvider = useMemo(() => {
    if (!selectedProviderCode) return null;
    return providerSummaries.find((p) => p.providerCode === selectedProviderCode) ?? null;
  }, [providerSummaries, selectedProviderCode]);

  const selectedProviderQuotes = useMemo(() => {
    if (!selectedProviderCode) return [];
    return quotes
      .filter((q) => q.providerCode === selectedProviderCode)
      .sort((a, b) => (a.estimatedAnnualTotalGBP ?? 1e18) - (b.estimatedAnnualTotalGBP ?? 1e18));
  }, [quotes, selectedProviderCode]);

  // Reset selection when data changes
  useEffect(() => {
    setSelectedProviderCode(null);
  }, [regionCode, compareRows.length]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-white shadow-sm" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M13 2L3 14H11L9 22L21 9H13L13 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">Voltly</div>
            <div className="text-xs text-slate-500">Upload → Extract → Compare</div>
          </div>
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <a className="text-sm text-slate-600 hover:text-slate-900" href="#how">
            How it works
          </a>
          <a className="text-sm text-slate-600 hover:text-slate-900" href="#privacy">
            Privacy
          </a>
          <button
            onClick={onPick}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 active:scale-[0.99]"
          >
            Upload bill
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="mx-auto grid max-w-3xl place-items-center pb-16 pt-10 text-center sm:pt-16">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">See what your bill would cost on other tariffs — in seconds.</h1>
          <p className="mt-4 max-w-2xl text-pretty text-base text-slate-600 sm:text-lg">
            Upload your bill and Voltly extracts your unit rates, standing charges and usage. Then you can compare against real supplier tariffs (from your Supabase database).
          </p>

          <div className="mt-10 w-full">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />

              <button
                onClick={onPick}
                disabled={busy}
                className="group relative mx-auto flex w-full max-w-xl items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-10 text-lg font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white shadow-sm" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M12 16V4M12 4L7 9M12 4L17 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 16V20H20V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>
                  {busy ? "Reading your bill…" : "Upload your bill"}
                  <span className="mt-1 block text-sm font-normal text-slate-500">PDF recommended (text-based bills work best)</span>
                </span>
              </button>

              <div className="mt-4 text-sm text-slate-500">
                {filename ? (
                  <span>
                    Selected: <span className="font-medium text-slate-700">{filename}</span>
                  </span>
                ) : (
                  <span>Tip: Text-based PDFs work best. If your bill is a scan/photo PDF, OCR support is required.</span>
                )}
              </div>

              {err && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{err}</div>}

              {extracted && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <span>
                    Extracted details ready. {usedOcrFallback && (
                      <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 border border-amber-300">
                        OCR
                      </span>
                    )} <span className="font-medium">Open the modal</span> to review & compare.
                  </span>
                  <button onClick={() => setOpen(true)} className="rounded-lg bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-600">
                    View extraction
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-5xl pb-16">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold">1) Upload</div>
              <div className="mt-2 text-sm text-slate-600">Drop in a PDF bill. We read the tariff section and consumption summary.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold">2) Extract</div>
              <div className="mt-2 text-sm text-slate-600">We pull unit rates, standing charges, and usage (where detectable).</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold">3) Compare</div>
              <div className="mt-2 text-sm text-slate-600">We compare against tariffs stored in Supabase for your region (default Region M).</div>
            </div>
          </div>
        </section>

        <section id="privacy" className="mx-auto max-w-5xl pb-20">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Privacy-first by design</div>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Voltly processes PDF text in your browser. Your bill file is not uploaded to a server during extraction.</li>
              <li>If you upload a scanned bill (no selectable text), OCR support is required to read it reliably.</li>
              <li>Tariff data is pulled from our Supabase-backed tariff database for your region.</li>
            </ul>
          </div>
        </section>
      </main>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto my-6 w-full max-w-6xl">
            <div className="h-[90vh] overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col">
              {/* header */}
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white p-5">
                <div>
                  <div className="text-lg font-semibold">Extracted bill details</div>
                  <div className="mt-1 text-sm text-slate-500">Review the extracted values, then compare against tariffs in your region.</div>

                  {usedOcrFallback && (
                    <div className="mt-3">
                      <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        OCR used — figures may be less accurate
                      </div>
                      <p className="mt-2 text-xs text-amber-900/80">
                        We used OCR because the PDF table was difficult to read reliably. Please double-check the kWh and rates.
                      </p>
                    </div>
                  )}
                </div>
                <button
                  className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <div className="grid h-full min-h-0 md:grid-cols-[1fr_400px]">
                  {/* left */}
                  <div className="min-h-0 overflow-y-auto p-5">
                {!extracted ? (
                  <div className="text-sm text-slate-600">No extraction available yet. Upload a PDF first.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-semibold text-slate-500">Supplier</div>
                        <div className="mt-1 text-sm font-medium">{extracted.supplier ?? "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-semibold text-slate-500">Tariff</div>
                        <div className="mt-1 text-sm font-medium">{extracted.tariffName ?? "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-semibold text-slate-500">Billing period</div>
                        <div className="mt-1 text-sm font-medium">{extracted.period ?? "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-semibold text-slate-500">Region</div>
                        <div className="mt-1 text-sm font-medium">{regionCode}</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">Your electricity rates</div>
                          <div className="mt-1 text-xs text-slate-500">Day/Night shown if detected.</div>
                        </div>
                        <div className="text-xs text-slate-500">Payment: {extracted.paymentMethod ?? "—"}</div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold text-slate-500">Day</div>
                          <div className="mt-1 text-sm font-medium">{formatPence(extracted.electricityDayRateP)}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold text-slate-500">Night</div>
                          <div className="mt-1 text-sm font-medium">{formatPence(extracted.electricityNightRateP)}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold text-slate-500">Standing</div>
                          <div className="mt-1 text-sm font-medium">{formatPence(extracted.electricityStandingPPerDay)} / day</div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold text-slate-500">Day kWh</div>
                          <div className="mt-1 text-sm font-medium">{extracted.electricDayKwh ?? "—"}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold text-slate-500">Night kWh</div>
                          <div className="mt-1 text-sm font-medium">{extracted.electricNightKwh ?? "—"}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold text-slate-500">Total kWh</div>
                          <div className="mt-1 text-sm font-medium">{extracted.electricTotalKwh ?? "—"}</div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="text-xs font-semibold text-slate-500">Estimated cost for this bill period (electricity)</div>
                        <div className="mt-1 text-base font-semibold">{formatGBP(yourAnnualElectricity)}</div>
	                      </div>

                      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="text-xs font-semibold text-slate-500">Bill period</div>
                        <div className="mt-1 text-sm font-medium">
                          {extracted.periodDays ? `${extracted.periodDays} days` : "—"}
                        </div>
                      </div>

                      {/* Breakdown by rate (mirrors bill table) */}
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">Breakdown by rate</div>
                            <div className="mt-1 text-xs text-slate-500">Uses the consumption detected from your bill and your current unit rates.</div>
                          </div>
                        </div>

                        {(() => {
                          const days = extracted.periodDays ?? null;
                          const dayRate = extracted.electricityDayRateP ?? null;
                          const nightRate = extracted.electricityNightRateP ?? null;
                          const stand = extracted.electricityStandingPPerDay ?? null;
                          // NOTE: kWh fields in Extracted are named `electric*Kwh` (not `electricity*Kwh`)
                          const dayKwh = extracted.electricDayKwh ?? null;
                          const nightKwh = extracted.electricNightKwh ?? null;

                          const rows: { label: string; rateP: number | null; kwh: number | null; cost: number | null }[] = [];
                          if (dayRate != null || dayKwh != null) {
                            const cost = dayRate != null && dayKwh != null ? (dayRate / 100) * dayKwh : null;
                            rows.push({ label: "Day", rateP: dayRate, kwh: dayKwh, cost });
                          }
                          if (nightRate != null || nightKwh != null) {
                            const cost = nightRate != null && nightKwh != null ? (nightRate / 100) * nightKwh : null;
                            rows.push({ label: "Night", rateP: nightRate, kwh: nightKwh, cost });
                          }
                          if (rows.length === 0) return <div className="mt-3 text-sm text-slate-600">No rate/consumption breakdown detected yet.</div>;

                          const standingCost = stand != null && days != null ? (stand / 100) * days : null;
                          const unitCost = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
                          const total = (standingCost != null ? unitCost + standingCost : null);

                          return (
                            <div className="mt-3">
                              <div className="overflow-hidden rounded-xl border border-slate-200">
                                <div className="grid grid-cols-4 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
                                  <div>Rate</div>
                                  <div className="text-right">Consumption</div>
                                  <div className="text-right">Unit rate</div>
                                  <div className="text-right">Cost</div>
                                </div>

                                {rows.map((r) => (
                                  <div key={r.label} className="grid grid-cols-4 px-3 py-2 text-sm">
                                    <div className="font-medium text-slate-700">{r.label}</div>
                                    <div className="text-right text-slate-700">{r.kwh != null ? `${r.kwh} kWh` : "—"}</div>
                                    <div className="text-right text-slate-700">{formatPence(r.rateP ?? undefined)}</div>
                                    <div className="text-right font-medium text-slate-900">{formatGBP(r.cost)}</div>
                                  </div>
                                ))}

                                <div className="grid grid-cols-4 bg-slate-50 px-3 py-2 text-sm">
                                  <div className="font-medium text-slate-700">Standing charge</div>
                                  <div className="text-right text-slate-700">{days != null ? `${days} days` : "—"}</div>
                                  <div className="text-right text-slate-700">
                                    {stand != null ? `${formatPence(stand)} / day` : "—"}
                                  </div>
                                  <div className="text-right font-medium text-slate-900">{formatGBP(standingCost)}</div>
                                </div>

                                <div className="grid grid-cols-4 px-3 py-2 text-sm">
                                  <div className="font-semibold text-slate-900">Total</div>
                                  <div />
                                  <div />
                                  <div className="text-right text-base font-semibold text-slate-900">{formatGBP(total)}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="mt-6 border-t border-slate-200 pt-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">Your gas rates</div>
                            <div className="mt-1 text-xs text-slate-500">Shown if detected from the PDF.</div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-[11px] font-semibold text-slate-500">Unit</div>
                            <div className="mt-1 text-sm font-medium">{formatPence(extracted.gasUnitRateP)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-[11px] font-semibold text-slate-500">Standing</div>
                            <div className="mt-1 text-sm font-medium">{formatPence(extracted.gasStandingPPerDay)} / day</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-[11px] font-semibold text-slate-500">Total kWh</div>
                            <div className="mt-1 text-sm font-medium">{extracted.gasTotalKwh ?? "—"}</div>
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-500">Estimated cost for this bill period (gas)</div>
                          <div className="mt-1 text-base font-semibold">{formatGBP(yourPeriodGas)}</div>
                        </div>

                        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold text-slate-500">Estimated cost for this bill period (total)</div>
                          <div className="mt-1 text-base font-semibold">{formatGBP(yourPeriodTotal)}</div>
                        </div>
                      </div>

                    </div>

                    {extracted.notes?.length ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        <div className="font-semibold">Notes</div>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {extracted.notes.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <details className="rounded-2xl border border-slate-200 p-4">
                      <summary className="cursor-pointer text-sm font-semibold">Technical details</summary>
                      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                        {extracted.rawTextSample}
                      </pre>
                    </details>
                  </div>
                )}
                  </div>

                  {/* right */}
                  <div className="min-h-0 overflow-y-auto border-t border-slate-200 bg-slate-50/40 p-5 md:border-l md:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Compare against</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Suppliers shown are only those with tariff rates in your database for region {regionCode}.
                    </div>
                  </div>
                  {bestOverall?.estimatedAnnualTotalGBP != null ? (
                    <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                      Cheapest: {bestOverall.providerName} ({formatGBP(bestOverall.estimatedAnnualTotalGBP)})
                    </div>
                  ) : null}
                </div>

                {/* Tariffs first: keeps the interesting bit (rates) visible without scrolling past the supplier list */}
                {selectedProviderCode ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">Tariffs</div>
                        <div className="mt-1 text-xs text-slate-500">Sorted cheapest first (estimated cost for your bill period usage).</div>
                      </div>
                      <button
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        onClick={() => setSelectedProviderCode(null)}
                      >
                        Change supplier
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3 max-h-[60vh] overflow-y-auto pr-1">
                      {selectedProviderQuotes.map((q) => {
                        const total = q.estimatedAnnualTotalGBP ?? null;
                        const base = bestOverall?.estimatedAnnualTotalGBP ?? null;
                        const delta = total != null && base != null ? total - base : null;
                        const pill = deltaPill(delta);
                        const pillCls =
                          pill.kind === "good"
                            ? "bg-emerald-100 text-emerald-800"
                            : pill.kind === "bad"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-slate-100 text-slate-700";

                        return (
                          <div key={`${q.providerCode}:${q.tariffName}`} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{q.tariffName}</div>
                                <div className="mt-1 text-xs text-slate-500">{q.tariffType ? q.tariffType : "Tariff"} • Region {q.regionCode}</div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-semibold">{formatGBP(total)}</div>
                                <span className={"mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold " + pillCls}>{pill.label}</span>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                              <div className="rounded-lg bg-slate-50 p-2">
                                <div className="font-semibold text-slate-700">Electricity</div>
                                <div className="mt-1">Unit: {q.elecUnitP != null ? `${q.elecUnitP.toFixed(2)}p/kWh` : "—"}</div>
                                <div className="mt-0.5">Standing: {q.elecStandingPPerDay != null ? `${q.elecStandingPPerDay.toFixed(2)}p/day` : "—"}</div>
                              </div>
                              <div className="rounded-lg bg-slate-50 p-2">
                                <div className="font-semibold text-slate-700">Gas</div>
                                <div className="mt-1">Unit: {q.gasUnitP != null ? `${q.gasUnitP.toFixed(2)}p/kWh` : "—"}</div>
                                <div className="mt-0.5">Standing: {q.gasStandingPPerDay != null ? `${q.gasStandingPPerDay.toFixed(2)}p/day` : "—"}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 lg:grid-cols-1">
                  {providersLoading ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading suppliers…</div>
                  ) : providersError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{providersError}</div>
                  ) : providerSummaries.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                      No supplier tariffs are currently available for region {regionCode}. Please try again later.
                    </div>
                  ) : (
                                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <details className="group">
                        <summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 flex items-center justify-between">
                          <span>All suppliers{" "}{selectedProvider ? `• Selected: ${selectedProvider.providerName}` : ""}</span>
                          <span className="text-xs font-semibold text-slate-500 group-open:rotate-180 transition-transform">▾</span>
                        </summary>
                        <div className="mt-2 max-h-80 overflow-y-auto pr-1">
                          <div className="grid gap-2">
                      {providerSummaries.map((p) => {
                        const active = selectedProviderCode === p.providerCode;
                        const cheapest = p.cheapest;
                        const total = cheapest?.estimatedAnnualTotalGBP ?? null;
                        const base = bestOverall?.estimatedAnnualTotalGBP ?? null;
                        const delta = total != null && base != null ? total - base : null;
                        const pill = deltaPill(delta);

                        const pillCls =
                          pill.kind === "good"
                            ? "bg-emerald-100 text-emerald-800"
                            : pill.kind === "bad"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-slate-100 text-slate-700";

                        return (
                          <button
                            key={p.providerCode}
                            onClick={() => setSelectedProviderCode(p.providerCode)}
                            className={[
                              "w-full rounded-2xl border p-4 text-left shadow-sm transition",
                              active ? "border-slate-900 bg-white" : "border-slate-200 bg-white hover:border-slate-300",
                            ].join(" ")}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{p.providerName}</div>
                                <div className="mt-1 truncate text-xs text-slate-500">
                                  Cheapest tariff: {cheapest?.tariffName ?? "—"}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <div className="text-sm font-semibold">{formatGBP(total)}</div>
                                <span className={"inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold " + pillCls}>
                                  {pill.label}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                          </div>
                        </div>
                      </details>
                    </div>
                  )}
                </div>

                {extracted?.electricityNightRateP != null && extracted?.electricityDayRateP != null ? (
                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Note: your bill looks like day/night (Economy 7). Supplier tariffs in your DB currently store a single electricity unit rate,
                    so comparisons use your <span className="font-semibold">total kWh</span> at that unit rate (no day/night split).
                  </div>
                ) : null}
	              </div>
	                </div>
	              </div>
	            </div>
	          </div>
	        </div>
      )}

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-sm text-slate-500">
          <div>© {new Date().getFullYear()} Voltly</div>
          <div className="flex gap-4">
            <span className="hidden sm:inline">Built for UK domestic bills</span>
          </div>
        </div>
      </footer>
    </div>
  );
}