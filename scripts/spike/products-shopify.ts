import { safeFetch } from "../../src/lib/safe-fetch.js";
import type { Product, ProductsResult } from "./schema.js";
import { USER_AGENT } from "./fetch-site.js";

interface ShopifyProductsJson {
  products: Array<{
    title: string;
    handle: string;
    published_at?: string | null;
  }>;
}

async function tryProductsJson(origin: string): Promise<ProductsResult | null> {
  const url = new URL("/products.json", origin).toString();
  let result;
  try {
    result = await safeFetch(url, { userAgent: USER_AGENT });
  } catch {
    return null;
  }
  if (result.status !== 200) return null;

  let parsed: ShopifyProductsJson;
  try {
    parsed = JSON.parse(result.html);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.products) || parsed.products.length === 0) return null;

  const hasRealDates = parsed.products.some((p) => Boolean(p.published_at));
  const sorted = [...parsed.products].sort((a, b) => {
    if (!a.published_at || !b.published_at) return 0;
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
  });

  const products: Product[] = sorted.slice(0, 10).map((p) => ({
    title: p.title,
    url: new URL(`/products/${p.handle}`, origin).toString(),
    publishedAt: p.published_at ?? null,
  }));

  return {
    status: "ok",
    dateBasis: hasRealDates ? "real_dates" : "listing_order",
    products,
    sourceUrl: url,
    capturedAt: new Date().toISOString(),
  };
}

async function trySitemap(origin: string): Promise<ProductsResult | null> {
  const candidates = ["/sitemap_products_1.xml", "/sitemap.xml"];
  for (const path of candidates) {
    const url = new URL(path, origin).toString();
    let result;
    try {
      result = await safeFetch(url, { userAgent: USER_AGENT });
    } catch {
      continue;
    }
    if (result.status !== 200) continue;

    const entries = [
      ...result.html.matchAll(/<url>\s*<loc>(.*?)<\/loc>(?:\s*<lastmod>(.*?)<\/lastmod>)?/g),
    ]
      .filter(([, loc]) => /\/products\//i.test(loc ?? ""))
      .slice(0, 10);
    if (entries.length === 0) continue;

    const hasRealDates = entries.some(([, , lastmod]) => Boolean(lastmod));
    const sorted = hasRealDates
      ? [...entries].sort((a, b) => {
          const dateA = a[2] ? new Date(a[2]).getTime() : 0;
          const dateB = b[2] ? new Date(b[2]).getTime() : 0;
          return dateB - dateA;
        })
      : entries;

    const products: Product[] = sorted.map(([, loc, lastmod]) => ({
      title: loc ? decodeURIComponent(loc.split("/").pop() ?? loc) : "unknown",
      url: loc ?? "",
      publishedAt: lastmod ?? null,
    }));

    return {
      status: "ok",
      dateBasis: hasRealDates ? "real_dates" : "listing_order",
      products,
      sourceUrl: url,
      capturedAt: new Date().toISOString(),
    };
  }
  return null;
}

/**
 * Tries Shopify's public /products.json endpoint, then sitemap diffing,
 * for a "new products" / "newest products" signal. Returns
 * "not_enough_data" rather than fabricating anything when both fail —
 * e.g. the store isn't Shopify, or it disables the endpoint.
 */
export async function fetchNewProducts(storeUrl: string): Promise<ProductsResult> {
  const origin = new URL(storeUrl).origin;

  const viaJson = await tryProductsJson(origin);
  if (viaJson) return viaJson;

  const viaSitemap = await trySitemap(origin);
  if (viaSitemap) return viaSitemap;

  return {
    status: "not_enough_data",
    reason: "no_products_json_or_sitemap_available",
    dateBasis: "none",
    products: [],
    sourceUrl: origin,
    capturedAt: new Date().toISOString(),
  };
}
