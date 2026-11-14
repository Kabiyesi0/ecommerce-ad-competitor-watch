import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPinnedLookup,
  isBlockedAddress,
  performPinnedRequest,
  safeFetch,
  SsrfBlockedError,
  TooManyRedirectsError,
} from "../../src/lib/safe-fetch.js";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public address %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe("safeFetch — protocol and address blocking", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(SsrfBlockedError);
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://[::1]/",
  ])("blocks %s", async (url) => {
    await expect(safeFetch(url)).rejects.toThrow(SsrfBlockedError);
  });
});

describe("safeFetch — redirect handling", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/to-private") {
        res.writeHead(302, { Location: "http://169.254.169.254/secret" });
        res.end();
        return;
      }
      if (req.url === "/loop") {
        res.writeHead(302, { Location: "/loop" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // The test server can only bind to loopback, which production validation
  // always blocks outright. This override allows exactly that one test
  // address through so the server is reachable, but still runs the real
  // `isBlockedAddress` check on every other host — including the host a
  // redirect points to — so the redirect-hop re-validation and the
  // redirect-capping logic are exercised for real, not bypassed.
  const allowOnlyTestServer = async (hostname: string) => {
    if (hostname === "127.0.0.1") return [hostname];
    if (isBlockedAddress(hostname)) {
      throw new SsrfBlockedError(`Blocked redirect target: ${hostname}`);
    }
    return [hostname];
  };

  it("re-validates on every redirect hop and blocks a redirect to a private address", async () => {
    await expect(
      safeFetch(`${baseUrl}/to-private`, { resolveHost: allowOnlyTestServer }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("caps redirect loops", async () => {
    await expect(
      safeFetch(`${baseUrl}/loop`, { maxRedirects: 2, resolveHost: allowOnlyTestServer }),
    ).rejects.toThrow(TooManyRedirectsError);
  });

  it("follows a normal (non-redirecting) request and returns its body", async () => {
    const result = await safeFetch(baseUrl, { resolveHost: allowOnlyTestServer });
    expect(result.status).toBe(200);
    expect(result.html).toBe("ok");
  });
});

describe("safeFetch — DNS rebinding", () => {
  // DNS rebinding means: the hostname resolves to a safe address at
  // validation time, then to a private address at connect time. The
  // defense is that safeFetch never performs a second DNS lookup between
  // those two points — it pins the exact validated address and uses it
  // for the real connection. These tests prove the pinning mechanism
  // itself never consults DNS again, using a real local server so the
  // proof is an actual successful connection, not just a mocked call count.
  let server: Server;
  let serverPort: number;

  beforeEach(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("pinned-server-reached");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    serverPort = typeof address === "object" && address ? address.port : 0;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("buildPinnedLookup ignores the hostname/options it is asked to resolve and always returns the pinned address", () => {
    const lookup = buildPinnedLookup("93.184.216.34");
    const results: Array<{ address: string; family: number }> = [];
    // Call it as undici would, but with a hostname that has nothing to do
    // with the pinned address — if this were a real DNS lookup it would
    // resolve to something else entirely, or fail. A pinned lookup must
    // ignore that input completely.
    lookup("totally-unrelated-rebinding-attacker.invalid", {}, (err, addrs) => {
      expect(err).toBeNull();
      results.push(...addrs);
    });
    expect(results).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("performPinnedRequest connects to the pinned address even though the request URL's hostname cannot resolve at all", async () => {
    // "rebinding-attacker.invalid" is not a real hostname and cannot be
    // resolved by any DNS server. If performPinnedRequest relied on a
    // fresh lookup of that hostname, this would fail outright. Instead it
    // must connect straight to the pinned 127.0.0.1 address (our test
    // server) and succeed, proving the connection target came only from
    // the pinned address, never from resolving the URL's hostname again.
    const result = await performPinnedRequest(
      `http://rebinding-attacker.invalid:${serverPort}/`,
      "127.0.0.1",
      { timeoutMs: 2000, maxBytes: 1024, userAgent: "test" },
    );
    expect(result.statusCode).toBe(200);
    expect(result.html).toBe("pinned-server-reached");
  });
});
