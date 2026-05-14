"use client";

import { PLATFORMS, PLATFORM_LABELS, type Platform, orderUrl } from "@/lib/deep-links";

type Props = {
  name: string;
  availability: Record<Platform, boolean>;
};

const PLATFORM_BG: Record<Platform, string> = {
  doordash: "bg-red-500 hover:bg-red-600",
  ubereats: "bg-green-600 hover:bg-green-700",
  grubhub: "bg-orange-500 hover:bg-orange-600",
};

// DoorDash availability isn't verified (Cloudflare blocks every scrape attempt
// from datacenter IPs), but its deep link still works — always show its button
// as a best-effort link. The other platforms only render when confirmed.
const ALWAYS_SHOW: Platform[] = ["doordash"];

export function OrderButtons({ name, availability }: Props) {
  const visible = PLATFORMS.filter((p) => ALWAYS_SHOW.includes(p) || availability[p]);
  if (visible.length === 0) return null;
  return (
    <div className="mt-2 flex gap-1.5">
      {visible.map((p) => (
        <a
          key={p}
          href={orderUrl(p, name)}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex-1 rounded-full px-2 py-1 text-center text-xs font-semibold text-white shadow-sm transition ${PLATFORM_BG[p]}`}
        >
          {PLATFORM_LABELS[p]}
        </a>
      ))}
    </div>
  );
}
