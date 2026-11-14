"use client";

import { useEffect, useRef, useState } from "react";
import { FREE_STORES } from "../lib/free-stores";
import type { ReportFixture, FreeStartInput } from "../lib/types";
import { LandingScreen } from "../components/LandingScreen";
import { RunningScreen } from "../components/RunningScreen";
import { ReportScreen } from "../components/ReportScreen";

type Stage = "landing" | "running" | "report";

export default function Home() {
  const [stage, setStage] = useState<Stage>("landing");
  const [storeId, setStoreId] = useState(FREE_STORES[0]!.id);
  const [freeInput, setFreeInput] = useState<{ storeUrl: string; competitorUrls: string[] } | null>(
    null,
  );
  const [freeFixture, setFreeFixture] = useState<ReportFixture | null>(null);
  const [freeError, setFreeError] = useState<string | null>(null);

  const demoStore = FREE_STORES.find((s) => s.id === storeId) ?? FREE_STORES[0]!;

  // Lets the browser/trackpad back gesture and the Mac Back keyboard
  // shortcut move between landing/running/report, same as any clickable
  // "start over" control would. We never change the URL (this is a
  // single-page app with no real routes) — just push a history entry
  // per stage so the back button has somewhere to go, and restore the
  // stage on popstate instead of re-running the stage transition logic.
  const restoringFromHistory = useRef(false);

  useEffect(() => {
    if (restoringFromHistory.current) {
      restoringFromHistory.current = false;
      return;
    }
    window.history.pushState({ stage }, "");
  }, [stage]);

  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const previousStage = (e.state?.stage as Stage | undefined) ?? "landing";
      restoringFromHistory.current = true;
      setStage(previousStage);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (stage !== "running" || !freeInput) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/free-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(freeInput),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setFreeError(data.error ?? "Something went wrong building the report.");
          setStage("landing");
          return;
        }
        setFreeFixture(data.fixture as ReportFixture);
        setStage("report");
      } catch {
        if (!cancelled) {
          setFreeError("Could not reach the server. Is the app running locally?");
          setStage("landing");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, freeInput]);

  function handleStart(input: FreeStartInput) {
    if (input.kind === "demo") {
      setFreeInput(null);
      setStoreId(input.id);
      setStage("running");
    } else {
      setFreeError(null);
      setFreeInput({ storeUrl: input.storeUrl, competitorUrls: input.competitorUrls });
      setStage("running");
    }
  }

  function startOver() {
    setFreeInput(null);
    setFreeFixture(null);
    setFreeError(null);
    setStage("landing");
  }

  if (stage === "landing") {
    return <LandingScreen onStart={handleStart} liveError={freeError} />;
  }

  if (stage === "running") {
    return <RunningScreen live={freeInput !== null} onDone={() => setStage("report")} />;
  }

  return (
    <ReportScreen fixture={freeInput ? freeFixture! : demoStore.fixture} onStartOver={startOver} />
  );
}
