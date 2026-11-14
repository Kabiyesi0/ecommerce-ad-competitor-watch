import { ArrowLeft } from "lucide-react";
import type { ReportFixture } from "../lib/types";
import { SummaryStrip } from "./SummaryStrip";
import { CompetitorCard } from "./CompetitorCard";
import { YourCompetitorsRow } from "./YourCompetitorsRow";

export function ReportScreen({
  fixture,
  onStartOver,
}: {
  fixture: ReportFixture;
  onStartOver: () => void;
}) {
  const captured = new Date(fixture.capturedAt);
  const dateLabel = captured.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const storeLabel = fixture.domain.replace(/-/g, ".");

  return (
    <main className="mx-auto min-h-screen max-w-content px-6 py-12 sm:py-16">
      <button
        type="button"
        onClick={onStartOver}
        className="focus-ring mb-6 inline-flex items-center gap-1.5 text-sm text-ink/45 hover:text-ink/70"
      >
        <ArrowLeft size={14} />
        Start another report
      </button>

      <header className="mb-6">
        <p className="section-label mb-2">Prepared for</p>
        <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">{storeLabel}</h1>
        <p className="mt-2 text-sm text-ink/45">
          {dateLabel}. Based on {fixture.competitors.length} competitors.
        </p>
      </header>

      <div className="space-y-6">
        <YourCompetitorsRow competitors={fixture.competitors} pickedByUser />
        <SummaryStrip summary={fixture.summary} />

        <section className="space-y-3">
          <p className="section-label px-1">Competitors</p>
          {fixture.competitors.map((c) => (
            <CompetitorCard
              key={c.domain}
              competitor={c}
              defaultOpen={false}
              showRebuildChecklist
            />
          ))}
        </section>
      </div>

      <footer className="mt-12 border-t border-hairline pt-6 text-xs leading-relaxed text-ink/35">
        <p>
          Built from public information as of {dateLabel}. We cannot see your sales or anyone&apos;s
          ad spend.
        </p>
        <p className="mt-1">
          Want this tailored to your store, with specific moves? Reply to my email.
        </p>
      </footer>
    </main>
  );
}
