/** "2026-11-06T13:02:19-07:00" -> "Nov 6, 2026". Returns null for a missing/unparseable date, never a raw timestamp. */
export function formatSourceDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
