import type { ReportFixture } from "./types";
import siennanaturals from "../fixtures-free/siennanaturals-com.json";
import shefit from "../fixtures-free/shefit-com.json";
import colorfulstandard from "../fixtures-free/colorfulstandard-com.json";
import girlfriend from "../fixtures-free/girlfriend-com.json";
import gotain from "../fixtures-free/gotain-com.json";

export interface FreeStoreOption {
  id: string;
  label: string;
  url: string;
  /** Already baked into the fixture — shown so a demo click reproduces exactly what it claims to, without re-fetching anything. */
  competitorUrls: string[];
  fixture: ReportFixture;
}

function competitorUrlsOf(fixture: ReportFixture): string[] {
  return fixture.competitors.map((c) => `https://${c.domain}`);
}

export const FREE_STORES: FreeStoreOption[] = [
  {
    id: "siennanaturals",
    label: "siennanaturals.com",
    url: "https://siennanaturals.com",
    competitorUrls: competitorUrlsOf(siennanaturals as ReportFixture),
    fixture: siennanaturals as ReportFixture,
  },
  {
    id: "shefit",
    label: "shefit.com",
    url: "https://shefit.com",
    competitorUrls: competitorUrlsOf(shefit as ReportFixture),
    fixture: shefit as ReportFixture,
  },
  {
    id: "colorfulstandard",
    label: "colorfulstandard.com",
    url: "https://colorfulstandard.com",
    competitorUrls: competitorUrlsOf(colorfulstandard as ReportFixture),
    fixture: colorfulstandard as ReportFixture,
  },
  {
    id: "girlfriend",
    label: "girlfriend.com",
    url: "https://girlfriend.com",
    competitorUrls: competitorUrlsOf(girlfriend as ReportFixture),
    fixture: girlfriend as ReportFixture,
  },
  {
    id: "gotain",
    label: "gotain.com",
    url: "https://gotain.com",
    competitorUrls: competitorUrlsOf(gotain as ReportFixture),
    fixture: gotain as ReportFixture,
  },
];
