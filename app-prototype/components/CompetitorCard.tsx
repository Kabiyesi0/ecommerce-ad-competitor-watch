"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AdFixture, CompetitorFixture } from "../lib/types";
import { Favicon } from "./Favicon";
import { formatSourceDate } from "../lib/format";
import { RebuildChecklist } from "./RebuildChecklist";

function DaysPill({ days }: { days: number | null }) {
  if (days === null) return null;
  const isLong = days >= 60;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${
        isLong ? "bg-accent-soft text-accent" : "bg-black/[0.04] text-ink/50"
      }`}
    >
      {days}d running
    </span>
  );
}

function AdThumbnail({ ad }: { ad: AdFixture }) {
  return (
    <a
      href={ad.adUrl}
      target="_blank"
      rel="noreferrer"
      data-testid="ad-thumbnail"
      className="focus-ring group block overflow-hidden rounded-row border border-hairline bg-white transition-shadow duration-150 hover:shadow-soft"
    >
      <div className="aspect-[4/5] w-full overflow-hidden bg-black/[0.03]">
        {ad.screenshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.screenshotUrl}
            alt="Ad screenshot"
            className="h-full w-full object-cover object-[center_28%] transition-transform duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink/30">
            No image
          </div>
        )}
      </div>
      <div className="space-y-1 p-2.5">
        <DaysPill days={ad.daysRunning} />
        <p className="text-[0.6875rem] text-ink/40">
          Started {formatSourceDate(ad.startDate) ?? "unknown date"}
        </p>
        <p className="line-clamp-2 text-xs leading-snug text-ink/60">{ad.adText}</p>
      </div>
    </a>
  );
}

function CollapsibleSubsection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-hairline pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <ChevronDown
          size={14}
          className={`text-ink/35 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0">
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

function AdsSubsection({
  competitor,
  showRebuildChecklist,
}: {
  competitor: CompetitorFixture;
  showRebuildChecklist: boolean;
}) {
  const [topAd, ...restAds] = competitor.topAds;
  return (
    <CollapsibleSubsection title="Ads probably performing">
      <p className="mb-3 text-xs leading-relaxed text-ink/40">
        Ranked by how long each ad has been running. Brands usually keep ads that work. We cannot
        see spend or sales.
      </p>
      {competitor.adsStatus === "not_enough_data" || competitor.topAds.length === 0 ? (
        <p className="text-sm text-ink/45">Not enough data</p>
      ) : showRebuildChecklist && topAd ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="w-full sm:w-[160px] sm:shrink-0">
              <AdThumbnail ad={topAd} />
            </div>
            <div className="flex-1">
              <RebuildChecklist ad={topAd} />
            </div>
          </div>
          {restAds.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {restAds.map((ad) => (
                <AdThumbnail key={ad.libraryId} ad={ad} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {competitor.topAds.map((ad) => (
            <AdThumbnail key={ad.libraryId} ad={ad} />
          ))}
        </div>
      )}
    </CollapsibleSubsection>
  );
}

function ProductsSubsection({ competitor }: { competitor: CompetitorFixture }) {
  return (
    <CollapsibleSubsection title="New products">
      {competitor.productsStatus === "not_enough_data" || competitor.newProducts.length === 0 ? (
        <p className="text-sm text-ink/45">Not enough data</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {competitor.newProducts.map((p) => {
            const dateLabel = formatSourceDate(p.publishedAt);
            return (
              <li key={p.url} className="py-2 text-sm text-ink/70">
                <span className="truncate text-ink/80">{p.title}</span>
                {dateLabel && <> · {dateLabel}</>}
                {" · "}
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring underline hover:text-ink"
                >
                  View product
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[0.6875rem] text-ink/30">
        Source: {competitor.productsSourceUrl}. Captured{" "}
        {competitor.productsCapturedAt.slice(0, 10)}.
      </p>
    </CollapsibleSubsection>
  );
}

export function CompetitorCard({
  competitor,
  defaultOpen,
  showRebuildChecklist = false,
}: {
  competitor: CompetitorFixture;
  defaultOpen: boolean;
  /** Puts a fixed "Rebuild checklist" block under the top ad specifically (free mode only). */
  showRebuildChecklist?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const preview = `${competitor.totalAdsFound} active ads, ${competitor.newProducts.length} new products`;

  return (
    <div className="rounded-card border border-hairline bg-white shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <Favicon domain={competitor.domain} size={22} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{competitor.name}</p>
          <p className="text-xs text-ink/40">{preview}</p>
        </div>
        <ChevronDown
          size={16}
          className={`shrink-0 text-ink/35 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0">
          <div className="space-y-4 px-5 pb-5">
            <AdsSubsection competitor={competitor} showRebuildChecklist={showRebuildChecklist} />
            <ProductsSubsection competitor={competitor} />
          </div>
        </div>
      </div>
    </div>
  );
}
