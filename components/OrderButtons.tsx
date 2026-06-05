"use client";

import { PLATFORMS, PLATFORM_LABELS, type Platform, orderUrl } from "@/lib/deep-links";
import type { DeliveryAvailability } from "@/lib/types";

type Props = {
  name: string;
  availability: DeliveryAvailability;
};

const PLATFORM_BG: Record<Platform, string> = {
  doordash: "bg-red-500 hover:bg-red-600",
  ubereats: "bg-green-600 hover:bg-green-700",
  grubhub: "bg-orange-500 hover:bg-orange-600",
};

// Grubhub/UberEats render only when confirmed. DoorDash renders unless it was
// confirmed absent ("no") — so a successful check that finds it missing hides
// the button, while an unverified/blocked check keeps the best-effort link.
function isVisible(p: Platform, a: DeliveryAvailability): boolean {
  if (p === "doordash") return a.doordash !== "no";
  if (p === "ubereats") return a.ubereats;
  return a.grubhub;
}

export function OrderButtons({ name, availability }: Props) {
  const visible = PLATFORMS.filter((p) => isVisible(p, availability));
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
