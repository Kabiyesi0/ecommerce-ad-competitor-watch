import type { CompetitorFixture } from "../lib/types";
import { Favicon } from "./Favicon";

export function YourCompetitorsRow({
  competitors,
  pickedByUser = false,
}: {
  competitors: CompetitorFixture[];
  /** True when the owner typed these in themselves (free mode) — never shows a "why picked" line either way, just name and domain. */
  pickedByUser?: boolean;
}) {
  const count = competitors.length;
  return (
    <section className="rounded-card border border-hairline bg-white px-5 py-4 shadow-soft sm:px-6">
      <p className="section-label mb-3">Your competitors</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {competitors.map((c) => (
          <div key={c.domain} className="flex items-center gap-2">
            <Favicon domain={c.domain} size={18} />
            <div>
              <p className="text-sm font-medium text-ink">{c.name}</p>
              <p className="text-xs text-ink/40">{c.domain}</p>
            </div>
          </div>
        ))}
      </div>
      {pickedByUser ? (
        <p className="mt-3 text-xs leading-relaxed text-ink/45">You asked us to check these.</p>
      ) : count < 3 ? (
        <p className="mt-3 text-xs leading-relaxed text-ink/45">
          We could only find {count} close {count === 1 ? "competitor" : "competitors"} for this
          store. We are showing what we have rather than padding the list with a weak match.
        </p>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-ink/45">
          These are the 3 closest stores we found. Want a report on specific competitors? Reply to
          my email.
        </p>
      )}
    </section>
  );
}
