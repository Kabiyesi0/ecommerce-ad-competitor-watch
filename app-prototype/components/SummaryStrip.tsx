import type { ReportFixture } from "../lib/types";

export function SummaryStrip({ summary }: { summary: ReportFixture["summary"] }) {
  const items = [
    { label: "Active ads found", value: summary.activeAdsFound },
    {
      label: "Longest-running ad",
      value:
        summary.longestRunningAdDays !== null
          ? `${summary.longestRunningAdDays} day${summary.longestRunningAdDays === 1 ? "" : "s"}`
          : "Not enough data",
    },
    { label: "New products, 30 days", value: summary.newProductsLast30Days },
  ];

  return (
    <div className="grid grid-cols-3 divide-x divide-hairline rounded-card border border-hairline bg-white shadow-soft">
      {items.map((item) => {
        const isShortNumber =
          typeof item.value === "number" || /^\d+ days?$/.test(String(item.value));
        return (
          <div key={item.label} className="px-3 py-5 text-center sm:px-6 sm:py-6">
            <p
              className={`font-serif tabular-nums tracking-tight text-ink ${
                isShortNumber ? "text-3xl sm:text-4xl" : "text-lg sm:text-xl"
              }`}
            >
              {item.value}
            </p>
            <p className="section-label mt-2">{item.label}</p>
          </div>
        );
      })}
    </div>
  );
}
