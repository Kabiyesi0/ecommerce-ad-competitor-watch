"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

const STEPS = [
  "Reading your store",
  "Reading their ads",
  "Reading their products",
  "Preparing your report",
];

/**
 * `live`: a real run is happening (duration unknown, could be a minute
 * or more) — the checklist loops through the steps as a progress cue
 * rather than finishing on a fixed timer. The parent owns the real
 * async work and switches screens itself once it resolves; `onDone` is
 * not called in this mode.
 */
export function RunningScreen({ onDone, live = false }: { onDone: () => void; live?: boolean }) {
  const [completed, setCompleted] = useState(0);

  useEffect(() => {
    if (live) {
      const stepTimer = setInterval(() => {
        setCompleted((i) => (i + 1) % (STEPS.length + 1));
      }, 1400);
      return () => clearInterval(stepTimer);
    }
    const stepTimer = setInterval(() => {
      setCompleted((i) => Math.min(i + 1, STEPS.length));
    }, 600);
    const doneTimer = setTimeout(onDone, 3000);
    return () => {
      clearInterval(stepTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone, live]);

  return (
    <main className="mx-auto flex min-h-screen max-w-content flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <ul className="space-y-4">
          {STEPS.map((step, i) => {
            const done = i < completed;
            const active = i === completed;
            return (
              <li key={step} className="flex items-center gap-3">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ${
                    done
                      ? "border-accent bg-accent text-paper"
                      : active
                        ? "border-ink/30"
                        : "border-hairline"
                  }`}
                >
                  {done && <Check size={12} strokeWidth={3} />}
                  {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/40" />}
                </span>
                <span
                  className={`text-sm transition-colors duration-200 ${
                    done ? "text-ink/40 line-through" : active ? "text-ink" : "text-ink/35"
                  }`}
                >
                  {step}
                </span>
              </li>
            );
          })}
        </ul>
        {live && (
          <p className="mt-6 text-center text-xs text-ink/35">This can take a minute or two.</p>
        )}
      </div>
    </main>
  );
}
