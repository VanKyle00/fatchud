"use client";

import type { FilterState } from "@/lib/types";

type Props = {
  filter: FilterState;
  cuisines: string[];
  onChange: (next: FilterState) => void;
};

const PRICE_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "$",
  2: "$$",
  3: "$$$",
  4: "$$$$",
};

function pretty(c: string): string {
  return c.replace(/_/g, " ");
}

export function FilterBar({ filter, cuisines, onChange }: Props) {
  const toggleCuisine = (c: string) => {
    const next = filter.cuisines.includes(c)
      ? filter.cuisines.filter((x) => x !== c)
      : [...filter.cuisines, c];
    onChange({ ...filter, cuisines: next });
  };

  return (
    <div className="flex flex-col gap-3 border-b border-black/5 dark:border-white/10 pb-3">
      <div className="flex items-center gap-2">
        <label className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Min ★
        </label>
        <input
          type="range"
          min={3}
          max={5}
          step={0.1}
          value={filter.minRating}
          onChange={(e) => onChange({ ...filter, minRating: Number(e.target.value) })}
          className="flex-1 accent-blue-500"
        />
        <span className="w-8 text-right text-xs tabular-nums">
          {filter.minRating.toFixed(1)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <label className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Max $
        </label>
        <div className="flex gap-1">
          {([1, 2, 3, 4] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onChange({ ...filter, maxPrice: level })}
              className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums transition ${
                filter.maxPrice === level
                  ? "bg-foreground text-background"
                  : "bg-black/5 dark:bg-white/10"
              }`}
            >
              {PRICE_LABELS[level]}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={filter.openNow}
            onChange={(e) => onChange({ ...filter, openNow: e.target.checked })}
            className="accent-blue-500"
          />
          Open now
        </label>
      </div>

      {cuisines.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cuisines.map((c) => {
            const active = filter.cuisines.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCuisine(c)}
                className={`rounded-full px-2 py-0.5 text-xs capitalize transition ${
                  active
                    ? "bg-blue-500 text-white"
                    : "bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
                }`}
              >
                {pretty(c)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
