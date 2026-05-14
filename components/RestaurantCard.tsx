"use client";

import type { Restaurant } from "@/lib/types";
import type { Platform } from "@/lib/deep-links";
import { OrderButtons } from "./OrderButtons";

type Props = {
  restaurant: Restaurant;
  selected: boolean;
  visited: boolean;
  availability: Record<Platform, boolean>;
  onClick: () => void;
  onToggleVisited: () => void;
};

function priceString(level: 1 | 2 | 3 | 4 | null): string {
  if (!level) return "";
  return "$".repeat(level);
}

function cuisineLabel(r: Restaurant): string {
  const type = r.primaryType ?? r.types[0] ?? "restaurant";
  return type.replace(/_/g, " ");
}

export function RestaurantCard({
  restaurant,
  selected,
  visited,
  availability,
  onClick,
  onToggleVisited,
}: Props) {
  const borderClass = selected
    ? "border-blue-500 bg-blue-500/5"
    : visited
      ? "border-green-500/50 bg-green-500/5"
      : "border-black/5 dark:border-white/10 hover:bg-black/[.03] dark:hover:bg-white/[.03]";

  return (
    <div className={`flex flex-col gap-1 rounded-2xl border p-3 transition ${borderClass}`}>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full flex-col gap-1 text-left"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">{restaurant.name}</span>
          {restaurant.rating !== null && (
            <span className="shrink-0 text-sm tabular-nums">
              ★ {restaurant.rating.toFixed(1)}
              {restaurant.userRatingCount !== null && (
                <span className="ml-1 text-zinc-500">
                  ({restaurant.userRatingCount})
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="capitalize">{cuisineLabel(restaurant)}</span>
          {restaurant.priceLevel && <span>· {priceString(restaurant.priceLevel)}</span>}
          {restaurant.openNow === true && <span>· Open</span>}
          {restaurant.openNow === false && <span>· Closed</span>}
        </div>
      </button>
      <label
        className="mt-1 flex w-fit cursor-pointer select-none items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={visited}
          onChange={onToggleVisited}
          className="h-3.5 w-3.5 cursor-pointer accent-green-600"
        />
        Been here
      </label>
      {selected && <OrderButtons name={restaurant.name} availability={availability} />}
    </div>
  );
}
