"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MoveFixture } from "../lib/types";
import { formatSourceDate } from "../lib/format";

function SourceLine({ source }: { source: MoveFixture["sources"][number] }) {
  const dateLabel = formatSourceDate(source.date);
  const linkLabel = source.kind === "ad" ? "View ad" : "View product";
  return (
    <li className="text-xs leading-relaxed text-ink/40">
      {source.brandName}
      {dateLabel && <> · {dateLabel}</>}
      {source.url && (
        <>
          {" · "}
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="focus-ring underline hover:text-ink/70"
          >
            {linkLabel}
          </a>
        </>
      )}
    </li>
  );
}

function MoveCard({ move, index }: { move: MoveFixture; index: number }) {
  return (
    <div className={`py-6 ${index > 0 ? "border-t border-hairline" : ""}`}>
      <p className="section-label mb-3">Move {index + 1}</p>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-8">
        <div>
          <p className="text-xs font-medium text-accent">What they did</p>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
            {move.competitorObservation}
          </p>
          <ul className="mt-3 space-y-1">
            {move.sources.map((s) => (
              <SourceLine key={s.findingId} source={s} />
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-ink/50">What you could do</p>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">{move.suggestion}</p>
        </div>
      </div>
    </div>
  );
}

export function MovesSection({
  moves,
  ownProductsStatus,
}: {
  moves: MoveFixture[];
  ownProductsStatus: "ok" | "not_enough_data";
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-card border border-hairline bg-white px-6 shadow-soft sm:px-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex w-full items-center justify-between py-6"
      >
        <h2 className="font-serif text-2xl tracking-tight text-ink">3 moves you could make</h2>
        <ChevronDown
          size={18}
          className={`text-ink/40 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0">
          <div className="pb-6">
            {ownProductsStatus === "not_enough_data" && (
              <p className="mb-2 text-xs text-ink/40">
                We could not read your own product list, so these moves are based only on your
                competitors.
              </p>
            )}
            {moves.length === 0 ? (
              <p className="text-sm text-ink/50">Not enough data to suggest moves yet.</p>
            ) : (
              moves.map((move, i) => <MoveCard key={i} move={move} index={i} />)
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
