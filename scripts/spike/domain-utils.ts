/** Lowercases and strips a leading "www." so the same site isn't treated
 * as two different domains depending on which mention produced the string. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}
