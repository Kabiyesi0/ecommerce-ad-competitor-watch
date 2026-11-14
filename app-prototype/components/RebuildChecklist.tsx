import type { AdFixture } from "../lib/types";

export function RebuildChecklist({ ad }: { ad: AdFixture }) {
  const signal =
    ad.creativeVariantCount && ad.creativeVariantCount > 1
      ? `They're running ${ad.creativeVariantCount} versions of this exact ad.`
      : ad.hasMultipleVersions
        ? "They're testing multiple versions of this exact ad."
        : null;

  return (
    <div className="rounded-card border border-accent/25 bg-accent-soft/50 p-4">
      <p className="section-label mb-2 text-accent">Rebuild checklist</p>
      {ad.hook ? (
        <blockquote className="border-l-2 border-accent/40 pl-3 text-sm italic leading-relaxed text-ink/75">
          &ldquo;{ad.hook}&rdquo;
        </blockquote>
      ) : (
        <p className="text-sm text-ink/55">Not enough ad text to quote directly.</p>
      )}
      {signal && <p className="mt-2 text-xs font-medium text-accent">{signal}</p>}
      <p className="mt-3 text-xs leading-relaxed text-ink/55">
        This is their longest-running ad — the strongest signal we have that it works. Match the
        hook above, match the format, swap in your own product and your own footage.
      </p>
    </div>
  );
}
