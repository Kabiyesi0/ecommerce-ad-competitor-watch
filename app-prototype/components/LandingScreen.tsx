"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, Plus, X } from "lucide-react";
import { FREE_STORES } from "../lib/free-stores";
import { isDomainLike, toBareDomain } from "../lib/validate-url";
import type { FreeStartInput } from "../lib/types";

const MAX_COMPETITORS = 3;

export function LandingScreen({
  onStart,
  liveError,
}: {
  onStart: (input: FreeStartInput) => void;
  liveError?: string | null;
}) {
  const [storeUrl, setStoreUrl] = useState("");
  const [competitorUrls, setCompetitorUrls] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);

  function updateCompetitor(index: number, value: string) {
    setCompetitorUrls((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  function addCompetitor() {
    if (competitorUrls.length < MAX_COMPETITORS) setCompetitorUrls((prev) => [...prev, ""]);
  }

  function removeCompetitor(index: number) {
    setCompetitorUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const storeTrimmed = storeUrl.trim();
    if (!storeTrimmed) {
      setError("Enter your store's web address.");
      return;
    }
    if (!isDomainLike(toBareDomain(storeTrimmed))) {
      setError("That doesn't look like a web address. Try something like yourstore.com.");
      return;
    }

    const filled = competitorUrls.map((u) => u.trim()).filter((u) => u.length > 0);
    if (filled.length === 0) {
      setError("Enter at least 1 competitor's web address.");
      return;
    }
    for (const u of filled) {
      if (!isDomainLike(toBareDomain(u))) {
        setError(`"${u}" doesn't look like a web address.`);
        return;
      }
    }
    const bareDomains = filled.map(toBareDomain);
    if (new Set(bareDomains).size !== bareDomains.length) {
      setError("Enter each competitor's web address only once.");
      return;
    }

    setError(null);
    onStart({
      kind: "free",
      storeUrl: toBareDomain(storeTrimmed),
      competitorUrls: filled.map(toBareDomain),
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-content flex-col px-6 py-16 sm:py-24">
      <div className="flex-1">
        <h1 className="font-serif text-[2.5rem] leading-[1.05] tracking-tight text-ink sm:text-[3.25rem]">
          See what your competitors are doing
        </h1>
        <p className="mt-4 max-w-md text-[1.0625rem] leading-relaxed text-ink/60">
          Enter your store&apos;s address and up to 3 competitors. We show their ads, how long each
          has been running, and their new products.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
          <input
            type="text"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder="yourstore.com"
            className="focus-ring w-full rounded-row border border-hairline bg-white px-5 py-4 text-base text-ink shadow-soft placeholder:text-ink/35"
          />

          <div className="flex flex-col gap-2">
            {competitorUrls.map((value, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={value}
                  onChange={(e) => updateCompetitor(i, e.target.value)}
                  placeholder={`competitor${i + 1 === 1 ? "" : i + 1}.com`}
                  className="focus-ring w-full rounded-row border border-hairline bg-white px-5 py-3.5 text-base text-ink shadow-soft placeholder:text-ink/35"
                />
                {competitorUrls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCompetitor(i)}
                    aria-label="Remove this competitor"
                    className="focus-ring inline-flex items-center justify-center rounded-row border border-hairline bg-white px-3 text-ink/40 hover:text-ink/70"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {competitorUrls.length < MAX_COMPETITORS && (
            <button
              type="button"
              onClick={addCompetitor}
              className="focus-ring inline-flex w-fit items-center gap-1 text-sm text-ink/50 hover:text-ink/80"
            >
              <Plus size={14} />
              Add another competitor
            </button>
          )}

          <button
            type="submit"
            className="focus-ring mt-2 inline-flex w-fit items-center justify-center gap-2 rounded-row bg-ink px-6 py-4 text-base font-medium text-paper transition-colors duration-150 hover:bg-ink/90"
          >
            Build my report
            <ArrowRight size={16} strokeWidth={2} />
          </button>
        </form>
        {(error || liveError) && <p className="mt-3 text-sm text-ink/50">{error ?? liveError}</p>}

        <div className="relative mt-16">
          <p className="section-label mb-4">A real report looks like this</p>
          <div className="pointer-events-none select-none opacity-[0.55]">
            <ReportPreviewCard />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-paper to-transparent" />
        </div>
      </div>

      <footer className="mt-16 flex items-center justify-between border-t border-hairline pt-6">
        <p className="text-xs text-ink/35">
          Built from public information. We never see sales or ad spend.
        </p>
        <div className="relative">
          <button
            type="button"
            onClick={() => setDemoOpen((v) => !v)}
            className="focus-ring inline-flex items-center gap-1 text-xs text-ink/45 underline decoration-ink/20 underline-offset-4 hover:text-ink/70"
          >
            Demo
            <ChevronDown size={12} />
          </button>
          {demoOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-48 rounded-row border border-hairline bg-white p-1 shadow-soft">
              {FREE_STORES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onStart({ kind: "demo", id: s.id })}
                  className="block w-full rounded-sm px-3 py-2 text-left text-sm text-ink/70 hover:bg-paper"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </footer>
    </main>
  );
}

function ReportPreviewCard() {
  const store = FREE_STORES[0]!;
  return (
    <div className="rounded-card border border-hairline bg-white p-6 shadow-soft">
      <p className="text-xs text-ink/40">Prepared for {store.label}</p>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <p className="font-serif text-2xl tabular-nums tracking-tight text-ink">
            {store.fixture.summary.activeAdsFound}
          </p>
          <p className="section-label mt-1">Active ads</p>
        </div>
        <div>
          <p className="font-serif text-2xl tabular-nums tracking-tight text-ink">
            {store.fixture.summary.longestRunningAdDays ?? "-"}
          </p>
          <p className="section-label mt-1">Longest running</p>
        </div>
        <div>
          <p className="font-serif text-2xl tabular-nums tracking-tight text-ink">
            {store.fixture.summary.newProductsLast30Days}
          </p>
          <p className="section-label mt-1">New products</p>
        </div>
      </div>
    </div>
  );
}
