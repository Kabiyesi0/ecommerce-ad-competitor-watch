const DOMAIN_LIKE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Strips a scheme and any path/query, leaving a bare domain for display or validation. */
export function toBareDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

/** True if the string looks like a plausible domain (yourstore.com) — a fast client/server-side sanity check, not SSRF validation. The real safety check (safe-fetch, done server-side) happens when the URL is actually fetched. */
export function isDomainLike(bareDomain: string): boolean {
  return DOMAIN_LIKE.test(bareDomain);
}
