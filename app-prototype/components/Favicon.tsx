"use client";

import { faviconUrl } from "../lib/favicon";

export function Favicon({ domain, size = 20 }: { domain: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={faviconUrl(domain, size * 2)}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-sm"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
