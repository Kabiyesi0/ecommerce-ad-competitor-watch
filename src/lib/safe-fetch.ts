import { isIPv4, isIPv6 } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, request as undiciRequest } from "undici";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export class TooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TooLargeError";
  }
}

export class TooManyRedirectsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TooManyRedirectsError";
  }
}

export interface SafeFetchOptions {
  /** Request+response time budget, per hop. Default 8000ms. */
  timeoutMs?: number;
  /** Max response bytes read. Default 2MB. */
  maxBytes?: number;
  /** Max redirects followed. Default 3. */
  maxRedirects?: number;
  /** Sent as the User-Agent header. */
  userAgent?: string;
  /**
   * Overrides hostname resolution/validation. Exists so tests can exercise
   * the redirect-following and redirect-cap logic against a local test
   * server (which can only bind to loopback, which production validation
   * always blocks) without weakening the real SSRF defaults. Never set
   * this outside tests — omitting it (the default) always uses the real
   * `resolveAndValidate`, which is what every production call path gets.
   */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

export interface SafeFetchResult {
  html: string;
  finalUrl: string;
  status: number;
  bytesRead: number;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_USER_AGENT = "CompetitorWatchBot/0.1 (+contact: set-a-real-contact-before-phase-1)";

// IPv4 CIDR ranges that must never be connected to: loopback, RFC1918
// private space, link-local (includes the 169.254.169.254 cloud metadata
// address), shared address space (RFC6598 / CGNAT, also used by some
// metadata services), and "this network" (0.0.0.0/8).
const BLOCKED_V4_RANGES: Array<[string, number]> = [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10],
  ["0.0.0.0", 8],
];

// IPv6 ranges: loopback, unique-local (fc00::/7), link-local (fe80::/10).
// IPv4-mapped addresses (::ffff:0:0/96) are unwrapped and re-checked
// against the v4 ranges above rather than being treated as a separate case.
const BLOCKED_V6_PREFIXES: Array<[string, number]> = [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isIpv4InRange(ip: string, base: string, prefixLength: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function ipv6ToBigInt(ip: string): bigint {
  const expanded = expandIpv6(ip);
  return expanded.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n);
}

function expandIpv6(ip: string): number[] {
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts];
  return groups.map((g) => Number.parseInt(g || "0", 16));
}

function isIpv6InRange(ip: string, base: string, prefixLength: number): boolean {
  const ipBig = ipv6ToBigInt(ip);
  const baseBig = ipv6ToBigInt(base);
  const mask =
    prefixLength === 0
      ? 0n
      : (0xffffffffffffffffffffffffffffffffn << BigInt(128 - prefixLength)) &
        0xffffffffffffffffffffffffffffffffn;
  return (ipBig & mask) === (baseBig & mask);
}

function extractV4Mapped(ip: string): string | null {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return match?.[1] ?? null;
}

/** Returns true if the given address must never be connected to. */
export function isBlockedAddress(ip: string): boolean {
  if (isIPv4(ip)) {
    return BLOCKED_V4_RANGES.some(([base, prefix]) => isIpv4InRange(ip, base, prefix));
  }
  if (isIPv6(ip)) {
    const mapped = extractV4Mapped(ip);
    if (mapped) return isBlockedAddress(mapped);
    return BLOCKED_V6_PREFIXES.some(([base, prefix]) => isIpv6InRange(ip, base, prefix));
  }
  // Not a valid IP literal at all — treat as blocked, never pass through.
  return true;
}

/**
 * The WHATWG URL parser keeps the brackets on an IPv6 literal host
 * (`new URL("http://[::1]/").hostname === "[::1]"`), but `net.isIPv6` and
 * `dns.lookup` both expect the bare address — strip them before any
 * address-shaped check.
 */
function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Resolves a hostname and rejects if ANY resolved address is in a blocked
 * range. Returns the validated addresses so the caller can pin the
 * connection to one of them (see safeFetch) instead of re-resolving later.
 */
async function resolveAndValidate(rawHostname: string): Promise<string[]> {
  const hostname = stripIpv6Brackets(rawHostname);
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new SsrfBlockedError(`Blocked address literal: ${hostname}`);
    }
    return [hostname];
  }
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new SsrfBlockedError(`No addresses resolved for host: ${hostname}`);
  }
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new SsrfBlockedError(
        `Host ${hostname} resolves to a blocked address: ${record.address}`,
      );
    }
  }
  return records.map((r) => r.address);
}

export type PinnedLookupFn = (
  hostname: string,
  options: unknown,
  callback: (err: Error | null, addresses: Array<{ address: string; family: number }>) => void,
) => void;

/**
 * Builds the undici `connect.lookup` callback that pins every connection
 * to `pinnedAddress`, no matter what hostname undici asks to resolve or
 * what a real DNS lookup for that hostname would return at this moment.
 * This is the exact mechanism that defeats DNS rebinding: it performs no
 * DNS resolution of its own, so a record that changed after the earlier
 * validation step can never influence where the socket connects.
 */
export function buildPinnedLookup(pinnedAddress: string): PinnedLookupFn {
  return (_hostname, _options, callback) => {
    callback(null, [{ address: pinnedAddress, family: isIPv4(pinnedAddress) ? 4 : 6 }]);
  };
}

interface PinnedRequestResult {
  statusCode: number;
  location: string | undefined;
  html: string;
  bytesRead: number;
}

/**
 * Performs one HTTP GET, with the TCP connection pinned to `pinnedAddress`
 * regardless of what the hostname resolves to at connect time — this is
 * what defeats DNS rebinding, since no second DNS lookup happens between
 * the caller's validation step and this connection. Exported separately
 * from `safeFetch` so the pinning behavior itself can be exercised in
 * tests against a local server, independent of the address-blocking logic
 * (which safeFetch always runs first, before this is ever called).
 */
export async function performPinnedRequest(
  url: string,
  pinnedAddress: string,
  opts: { timeoutMs: number; maxBytes: number; userAgent: string },
): Promise<PinnedRequestResult> {
  const agent = new Agent({
    connect: {
      lookup: buildPinnedLookup(pinnedAddress),
    },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const response = await undiciRequest(url, {
      method: "GET",
      headers: { "user-agent": opts.userAgent },
      // undici's request() never follows redirects on its own (unlike
      // fetch()), so no option is needed to disable that — every 3xx
      // response below is handled manually by the safeFetch loop.
      signal: controller.signal,
      dispatcher: agent,
    });

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      // Discard the (unneeded) redirect response body. destroy() aborts
      // the underlying socket read, which undici reports as an async
      // 'error' event — swallow it here since an unconsumed redirect body
      // is expected, not a real failure.
      response.body.on("error", () => undefined);
      response.body.destroy();
      return {
        statusCode: response.statusCode,
        location: typeof location === "string" ? location : undefined,
        html: "",
        bytesRead: 0,
      };
    }

    const chunks: Buffer[] = [];
    let bytesRead = 0;
    for await (const chunk of response.body) {
      bytesRead += chunk.length;
      if (bytesRead > opts.maxBytes) {
        response.body.on("error", () => undefined);
        response.body.destroy();
        throw new TooLargeError(`Response exceeded ${opts.maxBytes} bytes`);
      }
      chunks.push(chunk as Buffer);
    }

    return {
      statusCode: response.statusCode,
      location: undefined,
      html: Buffer.concat(chunks).toString("utf-8"),
      bytesRead,
    };
  } finally {
    clearTimeout(timeout);
    await agent.close();
  }
}

/**
 * Fetches a URL supplied by an untrusted source (a user-typed store URL).
 * Validates the hostname's resolved IP before connecting, pins the TCP
 * connection to that exact validated IP (so a DNS record change between
 * validation and connect — i.e. DNS rebinding — cannot redirect the
 * request to a private address), re-validates on every redirect hop, and
 * caps redirects, response size and time.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const resolveHost = opts.resolveHost ?? resolveAndValidate;

  const start = performance.now();
  let currentUrl = rawUrl;
  let redirectCount = 0;

  for (;;) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SsrfBlockedError(`Blocked protocol: ${parsed.protocol}`);
    }

    const validatedAddresses = await resolveHost(parsed.hostname);
    const pinnedAddress = validatedAddresses[0]!;

    const result = await performPinnedRequest(currentUrl, pinnedAddress, {
      timeoutMs,
      maxBytes,
      userAgent,
    });

    if (result.statusCode >= 300 && result.statusCode < 400) {
      if (!result.location) {
        throw new SsrfBlockedError("Redirect with no Location header");
      }
      redirectCount += 1;
      if (redirectCount > maxRedirects) {
        throw new TooManyRedirectsError(`Exceeded ${maxRedirects} redirects`);
      }
      currentUrl = new URL(result.location, currentUrl).toString();
      continue; // loop: re-validate the new host before following
    }

    return {
      html: result.html,
      finalUrl: currentUrl,
      status: result.statusCode,
      bytesRead: result.bytesRead,
      durationMs: performance.now() - start,
    };
  }
}
