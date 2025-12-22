"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase as supabaseClient } from "../lib/supabaseClient";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

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

type ProviderOption = {
  providerId: string;
  providerCode: string;
  providerName: string;
  tariffId: string;
  tariffName: string;
  tariffType: string;
  fuel: string;
  paymentMethod: string;
  termMonths?: number | null;
  endDate?: string | null;
  // electricity
  unitRateP: number;
  standingPPerDay: number;
  // gas (for later)
  gasUnitRateP: number;
  gasStandingPPerDay: number;
  lastUpdated?: string | null;
};

async function fetchProviderOptionsFromSupabase(regionCode: string): Promise<ProviderOption[]> {
  const sb = supabaseClient;
  if (!sb) throw new Error("Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");

  // Pull only suppliers that have at least one tariff rate row in the region:
  // tariff_rates (region_code=...) -> tariffs -> providers
  const { data, error } = await sb
    .from("tariff_rates")
    .select(
      `
      region_code,
      electricity_unit_rate_p_per_kwh,
      electricity_standing_charge_p_per_day,
      gas_unit_rate_p_per_kwh,
      gas_standing_charge_p_per_day,
      last_updated,
      tariffs!inner(
        id,
        tariff_name,
        tariff_type,
        fuel,
        payment_method,
        term_months,
        end_date,
        providers!inner(
          id,
          provider_code,
          provider_name
        )
      )
    `
    )
    .eq("region_code", regionCode);

  if (error) throw error;

  const rows = (data ?? []) as any[];

  return rows.map((r) => {
    const t = r.tariffs;
    const p = t?.providers;
    return {
      providerId: p?.id,
      providerCode: p?.provider_code,
      providerName: p?.provider_name,
      tariffId: t?.id,
      tariffName: t?.tariff_name,
      tariffType: t?.tariff_type,
      fuel: t?.fuel,
      paymentMethod: t?.payment_method,
      termMonths: t?.term_months ?? null,
      endDate: t?.end_date ?? null,
      unitRateP: Number(r.electricity_unit_rate_p_per_kwh),
      standingPPerDay: Number(r.electricity_standing_charge_p_per_day),
      gasUnitRateP: Number(r.gas_unit_rate_p_per_kwh),
      gasStandingPPerDay: Number(r.gas_standing_charge_p_per_day),
      lastUpdated: r.last_updated ?? null,
    } as ProviderOption;
  }).filter((x) => x.providerId && x.tariffId && Number.isFinite(x.unitRateP) && Number.isFinite(x.standingPPerDay));
}

function clampText(s: string, max = 900) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function numFromMatch(m?: RegExpMatchArray | null) {
  if (!m || !m[1]) return undefined;
  const v = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(v) ? v : undefined;
}

function parseVoltlyFromText(text: string): Extracted {
  const notes: string[] = [];
  const t = text;

  const supplier = /Octopus Energy/i.test(t) ? "Octopus Energy" : undefined;
  if (!supplier) notes.push("Supplier not confidently detected (demo parser is tuned for Octopus-style bills).");

  const accountNumber = (t.match(/Your Account Number:\s*([A-Z0-9-]+)/i) || [])[1];
  const billReference = (t.match(/Bill Reference:\s*([0-9]+)/i) || [])[1];

  const electricityEstimatedAnnualGBP = numFromMatch(t.match(/£\s*([0-9]+\.?[0-9]*)\s*a year for electricity/i));
  const gasEstimatedAnnualGBP = numFromMatch(t.match(/£\s*([0-9]+\.?[0-9]*)\s*a year for gas/i));

  const period = (t.match(/Your energy account\s*([0-9]{1,2}[a-z]{2}\s+\w+\.?\s+\d{4}\s*-\s*[0-9]{1,2}[a-z]{2}\s+\w+\.?\s+\d{4})/i) || [])[1];
  const postcodeAlpha = (t.match(/Postcode area alpha identifier:\s*([A-Z]+)/i) || [])[1];

  const tariffName = (t.match(/Tariff Name\s*([A-Za-z0-9\s-]+)/i) || [])[1]?.trim();
  const paymentMethod = (t.match(/Payment Method\s*([A-Za-z\s-]+)/i) || [])[1]?.trim();

  const electricityDayRateP = numFromMatch(t.match(/Unit Rate\s*\(Day\)\s*([0-9]+\.?[0-9]*)p\s*per\s*kWh/i));
  const electricityNightRateP = numFromMatch(t.match(/Unit Rate\s*\(Night\)\s*([0-9]+\.?[0-9]*)p\s*per\s*kWh/i));
  const electricityStandingPPerDay = numFromMatch(t.match(/Standing Charge\s*([0-9]+\.?[0-9]*)p\s*\/\s*day/i));
  const electricityStandingPerYearGBP = numFromMatch(
    t.match(/Standing Charge\s*[0-9]+\.?[0-9]*p\s*\/\s*day\s*\(£\s*([0-9]+\.?[0-9]*)\s*\/\s*year\)/i)
  );

  const electricTotalGBP = numFromMatch(t.match(/Total Electricity Charges\s*£\s*([0-9]+\.?[0-9]*)/i));
  const electricTotalKwh =
    numFromMatch(t.match(/Total consumption\s*([0-9]+\.?[0-9]*)\s*kWh/i)) ??
    numFromMatch(t.match(/Total consumption\s*([0-9]+\.?[0-9]*)kWh/i));

  if (!electricityDayRateP && !electricityNightRateP) notes.push("Could not find electricity unit rates (bill may be scanned or formatted differently).");
  if (!electricityStandingPPerDay) notes.push("Could not find electricity standing charge.");
  if (!electricTotalKwh) notes.push("Could not confidently extract total kWh usage.");

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
    electricTotalKwh,
    electricTotalGBP,
    gasEstimatedAnnualGBP,
    electricityEstimatedAnnualGBP,
    notes,
    rawTextSample: clampText(t),
  };
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent({ disableCombineTextItems: false });
    const strings = (content.items as any[])
      .map((it) => (typeof it?.str === "string" ? it.str : ""))
      .filter(Boolean);
    fullText += strings.join(" ") + "\n";
  }
  return fullText;
}

function formatPence(p?: number) {
  if (p == null) return "—";
  return `${p.toFixed(2)}p`;
}

function annualFromExtracted(extracted: Extracted) {
  // If bill provides estimated annual electric, prefer it. Otherwise approximate using extracted kWh and unit rates.
  if (extracted.electricityEstimatedAnnualGBP != null) return extracted.electricityEstimatedAnnualGBP;
  const totalKwh = extracted.electricTotalKwh ?? ( ((extracted.electricDayKwh || 0)) + ((extracted.electricNightKwh || 0)) );
  const unitP = (extracted.electricityDayRateP != null ? extracted.electricityDayRateP : extracted.electricityNightRateP) ?? 0;
  const standing = ((extracted.electricityStandingPPerDay ?? 0) / 100) * 365;
  return (totalKwh * (unitP / 100)) + standing;
}

function formatGBP(g?: number) {
  if (g == null) return "—";
  return `£${g.toFixed(2)}`;
}

function percent(n?: number) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(0)}%`;
}


type Provider = {
  provider?: string;
  providerName?: string;
  providerCode?: string;
  tariffName?: string;
  dayP: number;
  nightP?: number;
  standingPPerDay: number;
  estimatedAnnual?: number;
};

function annualCostGBP(extracted: Extracted, provider: Provider) {
  const dayKwh = (extracted.electricDayKwh || 0);
  const nightKwh = (extracted.electricNightKwh || 0);
  const totalKwh =
    extracted.electricTotalKwh != null ? extracted.electricTotalKwh : dayKwh + nightKwh;

  const unitRateP = provider.dayP;
  const energyCost = (totalKwh * unitRateP) / 100;
  const standing = (provider.standingPPerDay / 100) * 365;
  return energyCost + standing;
}

function currentAnnualCost(extracted: Extracted): number | undefined {
  const dayP = (extracted.electricityDayRateP != null ? extracted.electricityDayRateP : extracted.electricityNightRateP);
  const nightP = (extracted.electricityNightRateP != null ? extracted.electricityNightRateP : extracted.electricityDayRateP);
  const standing = extracted.electricityStandingPPerDay;

  if (dayP == null || nightP == null || standing == null) return undefined;
  const provider: Provider = { provider: "You", providerCode: "YOU", dayP, nightP, standingPPerDay: standing };
  return annualCostGBP(extracted, provider);
}

function deltaLabel(delta?: number) {
  if (delta == null || !Number.isFinite(delta)) return { label: "—", kind: "neutral" as const };
  if (Math.abs(delta) < 0.01) return { label: "No change", kind: "neutral" as const };
  if (delta < 0) return { label: `Save ${formatGBP(Math.abs(delta))}`, kind: "good" as const };
  return { label: `+${formatGBP(delta)}`, kind: "bad" as const };
}

export default function VoltlyLanding() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  
  const [supabaseMsg, setSupabaseMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null);

  const regionCode = (extracted?.postcodeAlpha || "M").toUpperCase();

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      const sb = supabaseClient;
      if (!sb) {
        setProvidersLoading(false);
        setProvidersError(
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel → Project Settings → Environment Variables."
        );
        return;
      }

      // No extracted bill yet → no need to load provider options
      if (!extracted) {
        setProviderOptions([]);
        return;
      }

      setProvidersLoading(true);
      setProvidersError(null);
      try {
        const opts = await fetchProviderOptionsFromSupabase(regionCode);
        if (!cancelled) setProviderOptions(opts);
      } catch (e: any) {
        const msg = typeof e?.message === "string" ? e.message : "Unknown error";
        if (!cancelled) {
          setProviderOptions([]);
          setProvidersError("Could not load suppliers from Supabase. " + msg);
        }
      } finally {
        if (!cancelled) setProvidersLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [extracted, regionCode]);

  const nightShare = useMemo(() => {
    if (!extracted?.electricNightKwh || !extracted?.electricTotalKwh) return undefined;
    if (extracted.electricTotalKwh <= 0) return undefined;
    return extracted.electricNightKwh / extracted.electricTotalKwh;
  }, [extracted]);

  const currentAnnual = useMemo(() => (extracted ? currentAnnualCost(extracted) : undefined), [extracted]);

  const providerQuotes = useMemo(() => {
  if (!extracted) return [];
  if (!providerOptions.length) return [];

  // For this MVP, we assume a single electricity unit rate per kWh (no separate night rate in DB).
  // If the uploaded bill includes day/night usage, we apply the same unit rate to both.
  const currentAnnual = annualFromExtracted(extracted);

  // Find the best (cheapest) tariff per provider
  const bestByProvider = new Map<string, { option: ProviderOption; annual: number }>();

  for (const option of providerOptions) {
    const annual = annualCostGBP(extracted, {
      provider: option.providerName,
      providerCode: option.providerCode,
      dayP: option.unitRateP,
      nightP: option.unitRateP,
      standingPPerDay: option.standingPPerDay,
      estimatedAnnual: 0,
    });

    const prev = bestByProvider.get(option.providerId);
    if (!prev || annual < prev.annual) bestByProvider.set(option.providerId, { option, annual });
  }

  const rows = Array.from(bestByProvider.values())
    .map(({ option, annual }) => {
      const delta = annual - currentAnnual;
      const cheaper = delta < 0;
      return {
        id: option.providerId + ":" + option.tariffId,
        providerId: option.providerId,
        provider: option.providerName,
        providerCode: option.providerCode,
        tariffId: option.tariffId,
        tariffName: option.tariffName,
        dayP: option.unitRateP,
        nightP: option.unitRateP,
        standingPPerDay: option.standingPPerDay,
        estimatedAnnual: annual,
        delta,
        cheaper,
      };
    })
    .sort((a, b) => a.estimatedAnnual - b.estimatedAnnual);

  return rows;
}, [extracted, providerOptions]);

  const onPick = () => fileRef.current?.click();

  const onFile = async (f?: File | null) => {
    setErr(null);
    setExtracted(null);
    setSelectedProvider(null);
    setFilename(f?.name ?? null);

    if (!f) return;

    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const isImage = f.type.startsWith("image/");

    setBusy(true);
    try {
      if (isPdf) {
        const text = await extractPdfText(f);
        const cleaned = text.replace(/\s+/g, " ").trim();

        if (cleaned.length < 200) {
          setErr("This PDF looks like a scan (no selectable text). This demo can only extract from text-based PDFs. Add backend OCR for scanned bills.");
          return;
        }

        const parsed = parseVoltlyFromText(text);
        setExtracted(parsed);
        setOpen(true);
      } else if (isImage) {
        setErr("Image upload detected. This demo extracts text from text-based PDFs only. For photos/scans, add backend OCR.");
      } else {
        setErr("Unsupported file type. Please upload a PDF bill.");
      }
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "Unknown error";
      setErr("Sorry — I couldn’t read that PDF. This is usually a PDF.js worker/CSP issue or a scanned PDF. Details: " + msg);
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

        <div className="hidden items-center gap-3 sm:flex">
          <a className="text-sm text-slate-600 hover:text-slate-900" href="#how">
            How it works
          </a>
          <a className="text-sm text-slate-600 hover:text-slate-900" href="#privacy">
            Privacy
          </a>
          <button onClick={onPick} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 active:scale-[0.99]">
            Upload bill
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="mx-auto grid max-w-3xl place-items-center pb-16 pt-10 text-center sm:pt-16">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">See what your bill would cost on other tariffs — in seconds.</h1>
          <p className="mt-4 max-w-2xl text-pretty text-base text-slate-600 sm:text-lg">
            Upload your bill and Voltly extracts unit rates, standing charges and usage (day/night where available). Then we show an instant estimate against other
            suppliers (demo uses mock rates for now).
          </p>

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
                  <span>
                    Selected: <span className="font-medium text-slate-700">{filename}</span>
                  </span>
                ) : (
                  <span>Tip: If your PDF is scanned, you’ll need OCR (we can add this to the backend later).</span>
                )}
              </div>

              {err && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{err}</div>}

              {extracted && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <span>
                    Extracted details ready. <span className="font-medium">Open the modal</span> to review.
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
              <div className="mt-2 text-sm text-slate-600">We pull unit rates, standing charges, and usage where available.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold">3) Compare</div>
              <div className="mt-2 text-sm text-slate-600">Voltly estimates annual cost and highlights savings (demo uses mock rates).</div>
            </div>
          </div>
        </section>

        <section id="privacy" className="mx-auto max-w-5xl pb-20">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Privacy-first by design</div>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>This demo processes text in your browser. No files are uploaded to a server.</li>
              <li>For production OCR + comparisons, we’d auto-delete bill files after a short period (e.g. 7–30 days).</li>
              <li>We only need tariff rates + usage to compare — not your entire bill history.</li>
            </ul>
          </div>
        </section>
      </main>

      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto my-6 w-full max-w-6xl">
            <div className="h-[90vh] overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col">
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white p-5">
                <div>
                  <div className="text-lg font-semibold">Extracted bill details</div>
                  <div className="mt-1 text-sm text-slate-500">Review these values before running comparisons.</div>
                </div>
                <button className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700" onClick={() => setOpen(false)} aria-label="Close">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                <div className="grid h-full min-h-0 md:grid-cols-[1fr_400px]">
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
                          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{extracted.rawTextSample}</pre>
                        </details>

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
                      </div>
                    )}
                  </div>

                  <aside className="min-h-0 border-t border-slate-200 bg-white md:border-l md:border-t-0">
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="border-b border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold">Compare against</div>
                            <div className="mt-1 text-xs text-slate-500">Pick a supplier — sorted by estimated annual cost. (Region: {regionCode})
                    {supabaseMsg ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        {supabaseMsg}
                      </div>
                    ) : null}</div>
                          </div>
                          {selectedProvider ? (
                            <button className="text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={() => setSelectedProvider(null)}>
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
                            {providersLoading ? (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
    Loading suppliers…
  </div>
) : providersError ? (
  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
    {providersError}
  </div>
) : providerQuotes.length === 0 ? (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
    No suppliers found for region {regionCode}.
  </div>
) : (
  providerQuotes.map(({ p, annual, delta }) => {
                              const active = selectedProvider?.name === p.name;
                              const d = deltaLabel(delta);
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
                                      <div className={["text-sm font-semibold", active ? "text-white" : "text-slate-900"].join(" ")}>{formatGBP(annual)}</div>
                                    </div>
                                  </div>
                                  <div className={["mt-0.5 text-xs", active ? "text-white/80" : "text-slate-500"].join(" ")}>
                                    Day {formatPence(p.dayP)} • Night {formatPence(p.nightP)} • Standing {formatPence(p.standingPPerDay)}/day
                                  </div>
                                </button>
                              );
                            })
)}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 border-t border-slate-200 bg-white p-4">
                        {!selectedProvider || !extracted ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-600">Select a supplier to see the comparison here.</div>
                        ) : (
                          (() => {
                            const other = annualCostGBP(extracted!, selectedProvider);
                            const delta = currentAnnual != null && other != null ? other - currentAnnual : undefined;
                            const d = deltaLabel(delta);
                            const cheaper = d.kind === "good";
                            const more = d.kind === "bad";

                            return (
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
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

                                <div className="mt-3 grid gap-2">
                                  <div className="flex items-center justify-between rounded-xl bg-white p-3">
                                    <div className="text-xs text-slate-600">You (from bill)</div>
                                    <div className="text-sm font-semibold">{formatGBP(currentAnnual)}</div>
                                  </div>
                                  <div className="flex items-center justify-between rounded-xl bg-white p-3">
                                    <div className="text-xs text-slate-600">{selectedProvider.name}</div>
                                    <div className="text-sm font-semibold">{formatGBP(other)}</div>
                                  </div>
                                </div>

                                <div
                                  className={[
                                    "mt-2 rounded-xl border p-3 text-sm",
                                    cheaper ? "border-emerald-200 bg-emerald-50 text-emerald-900" : more ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-white text-slate-700",
                                  ].join(" ")}
                                >
                                  {cheaper ? "Cheaper than your current estimate." : more ? "More expensive than your current estimate." : "—"}
                                </div>
                              </div>
                            );
                          })()
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