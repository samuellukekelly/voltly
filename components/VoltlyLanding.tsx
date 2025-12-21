"use client";
import React from "react";

const PROVIDERS = [
  "British Gas","Octopus Energy","EDF","E.ON Next","Scottish Power","OVO",
  "Shell Energy","Utilita","SSE","Good Energy","So Energy","Utility Warehouse"
];

export default function VoltlyLanding(){
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto max-w-6xl px-6 py-6 font-semibold text-xl">Voltly</header>
      <main className="mx-auto max-w-4xl px-6 text-center">
        <h1 className="text-4xl font-bold mt-12">Upload your bill. See better deals.</h1>
        <p className="mt-4 text-slate-600">
          Upload your energy bill and we’ll extract your rates and compare them against the market.
        </p>

        <div className="mt-10">
          <button className="rounded-xl bg-slate-900 px-8 py-4 text-white font-medium">
            Upload your bill
          </button>
        </div>

        <div className="mt-16">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-4">
            We compare against
          </div>
          <div className="overflow-hidden border rounded-2xl">
            <div className="flex w-max animate-marquee gap-4 p-4">
              {[...PROVIDERS, ...PROVIDERS].map((p, i) => (
                <div key={i} className="px-4 py-2 rounded-full bg-slate-100 text-sm whitespace-nowrap">
                  {p}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
