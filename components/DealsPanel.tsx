"use client";

import type { Restaurant } from "@/lib/types";
import type { Deal } from "@/lib/deals";
import { orderUrl } from "@/lib/deep-links";

type Props = {
  restaurants: Restaurant[];
  deals: Record<string, Deal[]>;
  loading: boolean;
  onSelect: (id: string) => void;
};

const KIND_LABEL: Record<Deal["kind"], string> = {
  bogo: "BOGO",
  free_item: "Free item",
  discount: "Discount",
};

export function DealsPanel({ restaurants, deals, loading, onSelect }: Props) {
  const withDeals = restaurants.filter((r) => (deals[r.id]?.length ?? 0) > 0);

  if (loading) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Finding deals…</p>
    );
  }
  if (withDeals.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No BOGO or free-item deals nearby right now.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {withDeals.map((r) => (
        <div
          key={r.id}
          className="flex flex-col gap-1.5 rounded-2xl border border-black/5 dark:border-white/10 p-3"
        >
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            className="flex w-full items-baseline justify-between gap-2 text-left"
          >
            <span className="truncate font-medium">{r.name}</span>
            {r.rating !== null && (
              <span className="shrink-0 text-sm tabular-nums">★ {r.rating.toFixed(1)}</span>
            )}
          </button>
          <div className="flex flex-wrap gap-1">
            {deals[r.id].map((d, i) => (
              <span
                key={i}
                className="rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
              >
                {KIND_LABEL[d.kind]}: {d.text}
              </span>
            ))}
          </div>
          <a
            href={orderUrl("ubereats", r.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 w-full rounded-full bg-green-600 px-2 py-1 text-center text-xs font-semibold text-white shadow-sm transition hover:bg-green-700"
          >
            Order on UberEats
          </a>
        </div>
      ))}
    </div>
  );
}
