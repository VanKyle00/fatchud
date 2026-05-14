"use client";

import { useEffect, useRef } from "react";
import type { FilterState, Restaurant } from "@/lib/types";
import type { Platform } from "@/lib/deep-links";
import type { VisitedSpinMode } from "@/lib/visited";
import { RestaurantCard } from "./RestaurantCard";
import { FilterBar } from "./FilterBar";
import { RandomPicker } from "./RandomPicker";

type Props = {
  restaurants: Restaurant[];
  filtered: Restaurant[];
  filter: FilterState;
  cuisines: string[];
  selectedId: string | null;
  availability: Record<string, Record<Platform, boolean>>;
  visited: Set<string>;
  spinMode: VisitedSpinMode;
  onSelect: (id: string) => void;
  onFilterChange: (next: FilterState) => void;
  onToggleVisited: (id: string) => void;
  onSpinModeChange: (next: VisitedSpinMode) => void;
  loading: boolean;
};

const EMPTY_AVAILABILITY: Record<Platform, boolean> = {
  doordash: false,
  ubereats: false,
  grubhub: false,
};

export function RestaurantPanel({
  restaurants,
  filtered,
  filter,
  cuisines,
  selectedId,
  availability,
  visited,
  spinMode,
  onSelect,
  onFilterChange,
  onToggleVisited,
  onSpinModeChange,
  loading,
}: Props) {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!selectedId) return;
    const el = cardRefs.current.get(selectedId);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div className="pointer-events-auto flex h-full flex-col gap-3 overflow-hidden rounded-3xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-black/60 p-4 shadow-xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold tracking-tight">Nearby</h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            {loading ? "…" : `${filtered.length}/${restaurants.length}`}
          </span>
        </div>
        <RandomPicker
          filtered={filtered}
          visited={visited}
          mode={spinMode}
          onModeChange={onSpinModeChange}
          onPick={onSelect}
        />
      </div>

      {restaurants.length > 0 && (
        <FilterBar filter={filter} cuisines={cuisines} onChange={onFilterChange} />
      )}

      <div className="flex flex-col gap-2 overflow-y-auto">
        {filtered.map((r) => (
          <div
            key={r.id}
            ref={(el) => {
              if (el) cardRefs.current.set(r.id, el);
              else cardRefs.current.delete(r.id);
            }}
          >
            <RestaurantCard
              restaurant={r}
              selected={r.id === selectedId}
              visited={visited.has(r.id)}
              availability={availability[r.id] ?? EMPTY_AVAILABILITY}
              onClick={() => onSelect(r.id)}
              onToggleVisited={() => onToggleVisited(r.id)}
            />
          </div>
        ))}
        {!loading && filtered.length === 0 && restaurants.length > 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No restaurants match your filters.
          </p>
        )}
        {!loading && restaurants.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Enter an address to see restaurants.
          </p>
        )}
      </div>
    </div>
  );
}
