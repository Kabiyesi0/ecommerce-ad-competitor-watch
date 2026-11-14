import type { ReportFixture } from "./types";
import siennanaturals from "../fixtures/siennanaturals-com.json";
import shefit from "../fixtures/shefit-com.json";
import colorfulstandard from "../fixtures/colorfulstandard-com.json";
import girlfriend from "../fixtures/girlfriend-com.json";
import gotain from "../fixtures/gotain-com.json";

export interface StoreOption {
  id: string;
  label: string;
  url: string;
  fixture: ReportFixture;
}

export const STORES: StoreOption[] = [
  {
    id: "siennanaturals",
    label: "siennanaturals.com",
    url: "https://siennanaturals.com",
    fixture: siennanaturals as ReportFixture,
  },
  {
    id: "shefit",
    label: "shefit.com",
    url: "https://shefit.com",
    fixture: shefit as ReportFixture,
  },
  {
    id: "colorfulstandard",
    label: "colorfulstandard.com",
    url: "https://colorfulstandard.com",
    fixture: colorfulstandard as ReportFixture,
  },
  {
    id: "girlfriend",
    label: "girlfriend.com",
    url: "https://girlfriend.com",
    fixture: girlfriend as ReportFixture,
  },
  {
    id: "gotain",
    label: "gotain.com",
    url: "https://gotain.com",
    fixture: gotain as ReportFixture,
  },
];

export function findStoreByUrlInput(input: string): StoreOption | null {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return (
    STORES.find(
      (s) => s.url.replace(/^https?:\/\//, "") === normalized || s.label === normalized,
    ) ?? null
  );
}
