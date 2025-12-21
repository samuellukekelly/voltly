"use client";

import React, { useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

try {
  // @ts-ignore
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
} catch {}

type Extracted = {
  supplier?: string;
  accountNumber?: string;
  billReference?: string;
  period?: string;
  postcodeAlpha?: string;
  tariffName?: string;
  paymentMethod?: string;

  electricityDayRateP?: number;
  electricityNightRateP?: number;
  electricityStandingPPerDay?: number;
  electricityStandingPerYearGBP?: number;

  electricDayKwh?: number;
  electricNightKwh?: number;
  electricTotalKwh?: number;

  electricTotalGBP?: number;
  gasEstimatedAnnualGBP?: number;
  electricityEstimatedAnnualGBP?: number;

  notes: string[];
  rawTextSample?: string;
};

type ProviderRate = {
  name: string;
  dayP: number;
  nightP?: number;
  standingPPerDay: number;
};

const PROVIDER_NAMES = [
  "British Gas",
  "Octopus Energy",
  "EDF Energy",
  "E.ON Next",
  "Scottish Power",
  "OVO",
  "Shell Energy",
  "Utilita",
  "SSE",
  "Good Energy",
  "So Energy",
  "Utility Warehouse",
];

function clampText(s: string, max = 1200) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function numFromMatch(m?: RegExpMatchArray | null) {
  if (!m || !m[1]) return undefined;
  const v = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(v) ? v : undefined;
}

function parseFromText(text: string): Extracted {
  const notes: string[] = [];
  const t = text;

  const supplier = /Octopus Energy/i.test(t) ? "Octopus Energy" : undefined;
  if (!supplier) notes.push("Supplier not confidently detected (parser optimised for Octopus-style bills).");

  const accountNumber = (t.match(/Your Account Number:\s*([A-Z0-9-]+)/i) || [])[1];
  const billReference = (t.match(/Bill Reference:\s*([0-9]+)/i) || [])[1];

  const electricityEstimatedAnnualGBP = numFromMatch(t.match(/£\s*([0-9]+\.?[0-9]*)\s*a year for electricity/i));
  const gasEstimatedAnnualGBP = numFromMatch(t.match(/£\s*([0-9]+\.?[0-9]*)\s*a year for gas/i));

  const period =
    (t.match(
      /Your energy account\s*([0-9]{1,2}[a-z]{2}\s+\w+\.?\s+\d{4}\s*-\s*[0-9]{1,2}[a-z]{2}\s+\w+\.?\s+\d{4})/i
    ) || [])[1];

  const postcodeAlpha = (t.match(/Postcode area alpha identifier:\s*([A-Z]+)/i) || [])[1];

  const tariffName = (t.match(/Tariff Name\s*([A-Za-z0-9\s-]+)/i) || [])[1]?.trim();
  const paymentMethod = (t.match(/Payment Method\s*([A-Za-z\s-]+)/i) || [])[1]?.trim();

  const electricityDayRateP = numFromMatch(t.match(/Unit Rate\s*\(Day\)\s*([0-9]+\.?[0-9]*)p\s*per\s*kWh/i));
  const electricityNightRateP = numFromMatch(t.match(/Unit Rate\s*\(Night\)\s*([0-9]+\.?[0-9]*)p\s*per\s*kWh/i));
  const electricityStandingPPerDay = numFromMatch(t.match(/Standing Charge\s*([0-9]+\.?[0-9]*)p\s*\/\s*day/i));
  const electricityStandingPerYearGBP = numFromMatch(
    t.match(/Standing Charge\s*[0-9]+\.?[0-9]*p\s*\/\s*day\s*\(£\s*([0-9]+\.?[0-9]*)\s*\/\s*year\)/i)
  );

  const nightKwh = numFromMatch(t.match(/8\.10p\s*\/\s*kWh\s*([0-9]+\.?[0-9]*)\s*kWh/i));
  const dayKwh = numFromMatch(t.match(/28\.42p\s*\/\s*kWh\s*([0-9]+\.?[0-9]*)\s*kWh/i));
  const totalKwh =
    numFromMatch(t.match(/Total consumption\s*([0-9]+\.?[0-9]*)\s*kWh/i)) ??
    numFromMatch(t.match(/Total consumption\s*([0-9]+\.?[0-9]*)kWh/i));

  const electricTotalGBP = numFromMatch(t.match(/Total Electricity Charges\s*£\s*([0-9]+\.?[0-9]*)/i));

  if (!electricityDayRateP && !electricityNightRateP) notes.push("Could not find electricity unit rates.");
  if (!electricityStandingPPerDay) notes.push("Could not find electricity standing charge.");
  if (!totalKwh) notes.push("Could not confidently extract total kWh usage.");

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
    electricityStandingPerYearGBP,
    electricDayKwh: dayKwh,
    electricNightKwh: nightKwh,
    electricTotalKwh: totalKwh,
    electricTotalGBP,
    gasEstimatedAnnualGBP,
    electricityEstimatedAnnualGBP,
    notes,
    rawTextSample: clampText(t, 900),
  };
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  // @ts-ignore
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  // @ts-ignore
  const pdf = await loadingTask.promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent({ disableCombineTextItems: false });
    const strings = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);
    fullText += strings.join(" ") + "\n";
  }
  return fullText;
}

function formatPence(p?: number) {
  if (p == null) return "—";
  return `${p.toFixed(2)}p`;
}
function formatGBP(g?: number) {
  if (g == null) return "—";
  return `£${g.toFixed(2)}`;
}
function percent(n?: number) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function annualCostGBP(ex: Extracted, rate: ProviderRate): number | undefined {
  const totalKwh = ex.electricTotalKwh;
  if (!totalKwh || totalKwh <= 0) return undefined;

  const nightKwh = ex.electricNightKwh;
  const dayKwh = ex.electricDayKwh ?? (nightKwh != null ? Math.max(totalKwh - nightKwh, 0) : undefined);

  const hasSplit = dayKwh != null && nightKwh != null && rate.nightP != null;

  const unitGBP = hasSplit
    ? (dayKwh * (rate.dayP / 100)) + (nightKwh * ((rate.nightP ?? rate.dayP) / 100))
    : totalKwh * (rate.dayP / 100);

  const standingGBP = (rate.standingPPerDay / 100) * 365;

  return unitGBP + standingGBP;
}


function currentAnnualCost(ex: Extracted): number | undefined {
  const dayP = ex.electricityDayRateP;
  const standing = ex.electricityStandingPPerDay;
  if (dayP == null || standing == null) return undefined;
  return annualCostGBP(ex, {
    name: "Current",
    dayP,
    nightP: ex.electricityNightRateP,
    standingPPerDay: standing,
  });
}

function formatDelta(delta?: number) {
  if (delta == null || !Number.isFinite(delta)) return { label: "—", kind: "neutral" as const };
  if (Math.abs(delta) < 0.005) return { label: "Same price", kind: "neutral" as const };
  if (delta < 0) return { label: `Save £${Math.abs(delta).toFixed(2)}`, kind: "good" as const };
  return { label: `+£${delta.toFixed(2)}`, kind: "bad" as const };
}

export default function VoltlyLanding() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderRate | null>(null);

  const providers: ProviderRate[] = useMemo(
    () => [
      { name: "E.ON Next", dayP: 28.10, nightP: 9.00, standingPPerDay: 48.5 },
      { name: "EDF Energy", dayP: 28.40, nightP: 9.20, standingPPerDay: 49.0 },
      { name: "So Energy", dayP: 28.30, nightP: 9.10, standingPPerDay: 49.5 },
      { name: "OVO", dayP: 28.60, nightP: 9.40, standingPPerDay: 50.5 },
      { name: "British Gas", dayP: 28.90, nightP: 9.50, standingPPerDay: 50.0 },
      { name: "Shell Energy", dayP: 28.75, nightP: 9.60, standingPPerDay: 51.0 },
      { name: "SSE", dayP: 28.95, nightP: 9.65, standingPPerDay: 50.8 },
      { name: "Good Energy", dayP: 29.10, nightP: 9.90, standingPPerDay: 51.2 },
      { name: "Scottish Power", dayP: 29.20, nightP: 9.80, standingPPerDay: 51.5 },
      { name: "Utilita", dayP: 29.50, nightP: 10.10, standingPPerDay: 52.0 },
      { name: "Utility Warehouse", dayP: 29.30, nightP: 10.00, standingPPerDay: 52.5 },
      { name: "Octopus Energy", dayP: 27.10, nightP: 8.00, standingPPerDay: 46.0 },
    ],
    []
  );

  const providerQuotes = useMemo(() => {
  if (!extracted) return [];
  const current = currentAnnualCost(extracted);
  return providers
    .map((p) => {
      const annual = annualCostGBP(extracted, p);
      const delta = current != null && annual != null ? annual - current : undefined;
      return { p, annual, delta };
    })
    .filter((x) => x.annual != null)
    .sort((a, b) => a.annual! - b.annual!);
}, [providers, extracted]);

  const nightShare = useMemo(() => {
    if (!extracted?.electricNightKwh || !extracted?.electricTotalKwh) return undefined;
    if (extracted.electricTotalKwh <= 0) return undefined;
    return extracted.electricNightKwh / extracted.electricTotalKwh;
  }, [extracted]);

  const onPick = () => fileRef.current?.click();

  const onFile = async (f?: File | null) => {
    setErr(null);
    setExtracted(null);
    setFilename(f?.name ?? null);
    setSelectedProvider(null);

    if (!f) return;

    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const isImage = f.type.startsWith("image/");

    setBusy(true);
    try {
      if (isPdf) {
        const text = await extractPdfText(f);
        const cleaned = text.replace(/\s+/g, " ").trim();

        if (cleaned.length < 200) {
          setErr("This PDF looks like a scan (no selectable text). This demo can only extract from text-based PDFs.");
          return;
        }

        const parsed = parseFromText(text);
        setExtracted(parsed);
        setOpen(true);
      } else if (isImage) {
        setErr("Image upload detected. This demo extracts from text-based PDFs only (OCR needs a backend).");
      } else {
        setErr("Unsupported file type. Please upload a PDF bill.");
      }
    } catch (e: any) {
      setErr("Sorry — I couldn’t read that PDF. Details: " + (e?.message ?? "Unknown error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-white shadow-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M13 2L3 14H11L9 22L21 9H13L13 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">Voltly</div>
            <div className="text-xs text-slate-500">Upload → Extract → Compare</div>
          </div>
        </div>

        <button onClick={onPick} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800">
          Upload bill
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="mx-auto grid max-w-3xl place-items-center pb-16 pt-10 text-center sm:pt-16">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
            See what your bill would cost on other tariffs — in seconds.
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-base text-slate-600 sm:text-lg">
            Upload your bill and Voltly extracts your rates + usage. Then compare against other suppliers.
          </p>

          <div className="mt-8 w-full max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">We compare against</div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="relative">
                <div className="flex w-max animate-marquee gap-3 p-4">
                  {[...PROVIDER_NAMES, ...PROVIDER_NAMES].map((name, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-white shadow-sm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                          <path d="M13 2L3 14H11L9 22L21 9H13L13 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="whitespace-nowrap">{name}</span>
                    </div>
                  ))}
                </div>
                <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-white to-transparent" />
                <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent" />
              </div>
            </div>
          </div>

          <div className="mt-10 w-full">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />

              <button
                onClick={onPick}
                disabled={busy}
                className="group relative mx-auto flex w-full max-w-xl items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-10 text-lg font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white shadow-sm">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
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
                  <span>Selected: <span className="font-medium text-slate-700">{filename}</span></span>
                ) : (
                  <span>Tip: Scanned PDFs need OCR (backend).</span>
                )}
              </div>

              {err && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{err}</div>}
            </div>
          </div>
        </section>
      </main>

      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto my-6 w-full max-w-6xl">
            <div className="max-h-[calc(100vh-3rem)] overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col">
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white p-5">
                <div>
                  <div className="text-lg font-semibold">Extracted bill details</div>
                  <div className="mt-1 text-sm text-slate-500">Review these values before running comparisons.</div>
                </div>
                <button
                  className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                <div className="grid h-full min-h-0 md:grid-cols-[1fr_380px]">
                  {/* LEFT: extracted details */}
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
                            <div className="text-xs font-semibold text-slate-500">Region alpha</div>
                            <div className="mt-1 text-sm font-medium">{extracted.postcodeAlpha ?? "—"}</div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">Electricity rates</div>
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
                              <div className="text-xs text-slate-500">{formatGBP(extracted.electricityStandingPerYearGBP)} / year</div>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-4">
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
                            <div className="rounded-xl bg-slate-50 p-3">
                              <div className="text-[11px] font-semibold text-slate-500">Night share</div>
                              <div className="mt-1 text-sm font-medium">{percent(nightShare)}</div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm">
                              <span className="text-slate-500">Electric total (bill): </span>
                              <span className="font-semibold">{formatGBP(extracted.electricTotalGBP)}</span>
                            </div>
                            <div className="text-sm">
                              <span className="text-slate-500">Est. annual electric: </span>
                              <span className="font-semibold">{formatGBP(extracted.electricityEstimatedAnnualGBP)}</span>
                            </div>
                            <div className="text-sm">
                              <span className="text-slate-500">Est. annual gas: </span>
                              <span className="font-semibold">{formatGBP(extracted.gasEstimatedAnnualGBP)}</span>
                            </div>
                          </div>
                        </div>

                        <details className="rounded-2xl border border-slate-200 p-4">
                          <summary className="cursor-pointer text-sm font-semibold">Raw text sample (debug)</summary>
                          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                            {extracted.rawTextSample}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>

                  {/* RIGHT: compare list + comparison */}
                  <aside className="min-h-0 border-t border-slate-200 bg-white md:border-l md:border-t-0">
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="border-b border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold">Compare against</div>
                            <div className="mt-1 text-xs text-slate-500">Pick a supplier — sorted by estimated annual cost.</div>
                          </div>
                          {selectedProvider ? (
                            <button
                              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                              onClick={() => setSelectedProvider(null)}
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto p-4">
                        {!extracted ? (
                          <div className="text-sm text-slate-600">Upload a bill to enable comparisons.</div>
                        ) : (
                          <div className="space-y-2">
                            {providerQuotes.map(({ p, annual, delta }) => {
                              const active = selectedProvider?.name === p.name;
                              const d = formatDelta(delta);
                              return (
                                <button
                                  key={p.name}
                                  onClick={() => setSelectedProvider(p)}
                                  className={[
                                    "w-full rounded-xl border px-3 py-2 text-left transition",
                                    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:bg-slate-50",
                                  ].join(" ")}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-semibold">{p.name}</div>
                                    <div className="flex items-center gap-2">
                                      {delta != null ? (
                                        <span
                                          className={[
                                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                            d.kind === "good"
                                              ? active
                                                ? "bg-emerald-500/20 text-white"
                                                : "bg-emerald-100 text-emerald-800"
                                              : d.kind === "bad"
                                              ? active
                                                ? "bg-rose-500/20 text-white"
                                                : "bg-rose-100 text-rose-800"
                                              : active
                                              ? "bg-white/20 text-white"
                                              : "bg-slate-100 text-slate-700",
                                          ].join(" ")}
                                        >
                                          {d.label}
                                        </span>
                                      ) : null}
                                      <div className={["text-sm font-semibold", active ? "text-white" : "text-slate-900"].join(" ")}>
                                        {formatGBP(annual)}
                                      </div>
                                    </div>
                                  </div>
                                  <div className={["mt-0.5 text-xs", active ? "text-white/80" : "text-slate-500"].join(" ")}>
                                    Day {formatPence(p.dayP)} • Night {formatPence(p.nightP)} • Standing {formatPence(p.standingPPerDay)}/day
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {selectedProvider && extracted ? (
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            {(() => {
                              const current = currentAnnualCost(extracted);
                              const other = annualCostGBP(extracted, selectedProvider);
                              const delta = current != null && other != null ? other - current : undefined;
                              const d = formatDelta(delta);
                              const cheaper = d.kind === "good";
                              const more = d.kind === "bad";

                              return (
                                <div className="space-y-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold">Estimated annual comparison</div>
                                      <div className="mt-1 text-xs text-slate-600">Demo uses mock supplier rates for now.</div>
                                    </div>
                                    <span
                                      className={[
                                        "rounded-full px-2 py-1 text-xs font-semibold",
                                        cheaper ? "bg-emerald-100 text-emerald-900" : more ? "bg-rose-100 text-rose-900" : "bg-white text-slate-700",
                                      ].join(" ")}
                                    >
                                      {d.label}
                                    </span>
                                  </div>

                                  <div className="grid gap-2">
                                    <div className="flex items-center justify-between rounded-xl bg-white p-3">
                                      <div className="text-xs text-slate-600">You (from bill)</div>
                                      <div className="text-sm font-semibold">{formatGBP(current)}</div>
                                    </div>
                                    <div className="flex items-center justify-between rounded-xl bg-white p-3">
                                      <div className="text-xs text-slate-600">{selectedProvider.name}</div>
                                      <div className="text-sm font-semibold">{formatGBP(other)}</div>
                                    </div>
                                  </div>

                                  <div
                                    className={[
                                      "rounded-xl border p-3 text-sm",
                                      cheaper
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                        : more
                                        ? "border-rose-200 bg-rose-50 text-rose-900"
                                        : "border-slate-200 bg-white text-slate-700",
                                    ].join(" ")}
                                  >
                                    {cheaper ? "Cheaper than your current estimate." : more ? "More expensive than your current estimate." : "—"}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-600">
                            Select a supplier to see the comparison here.
                          </div>
                        )}
                      </div>
                    </div>
                  </aside>
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
