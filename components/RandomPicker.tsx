"use client";

import { useMemo, useState } from "react";
import type { Restaurant } from "@/lib/types";
import type { VisitedSpinMode } from "@/lib/visited";

type Props = {
  filtered: Restaurant[];
  visited: Set<string>;
  mode: VisitedSpinMode;
  onModeChange: (next: VisitedSpinMode) => void;
  onPick: (id: string) => void;
};

export function RandomPicker({ filtered, visited, mode, onModeChange, onPick }: Props) {
  const [spinning, setSpinning] = useState(false);

  const pool = useMemo(() => {
    if (mode === "exclude") return filtered.filter((r) => !visited.has(r.id));
    if (mode === "only") return filtered.filter((r) => visited.has(r.id));
    return filtered;
  }, [filtered, visited, mode]);

  const disabled = pool.length === 0 || spinning;

  const spin = () => {
    if (disabled) return;
    setSpinning(true);

    const start = performance.now();
    const duration = 900;
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= duration) {
        const final = pool[Math.floor(Math.random() * pool.length)];
        onPick(final.id);
        setSpinning(false);
        return;
      }
      const interval = 50 + (elapsed / duration) * 200;
      if (elapsed % interval < 16) {
        const flicker = pool[Math.floor(Math.random() * pool.length)];
        onPick(flicker.id);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={mode}
        onChange={(e) => onModeChange(e.target.value as VisitedSpinMode)}
        aria-label="Visited filter for spin"
        className="rounded-full border border-black/10 bg-white/70 dark:border-white/10 dark:bg-black/40 px-2 py-1 text-xs font-medium"
      >
        <option value="all">All</option>
        <option value="exclude">Skip visited</option>
        <option value="only">Only visited</option>
      </select>
      <button
        type="button"
        onClick={spin}
        disabled={disabled}
        className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-md transition disabled:opacity-40"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={spinning ? "animate-spin" : ""}
          aria-hidden
        >
          <path d="M16 3h5v5" />
          <path d="M4 20L21 3" />
          <path d="M21 16v5h-5" />
          <path d="M15 15l6 6" />
          <path d="M4 4l5 5" />
        </svg>
        <span>{spinning ? "Picking…" : "Spin"}</span>
      </button>
    </div>
  );
}
