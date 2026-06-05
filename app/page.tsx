"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AddressInput } from "@/components/AddressInput";
import { MapView } from "@/components/MapView";
import { RestaurantPanel } from "@/components/RestaurantPanel";
import { DEFAULT_FILTER, applyFilters, availableCuisines } from "@/lib/filters";
import { fetchIpLocation } from "@/lib/ip-location";
import { useVisited, type VisitedSpinMode } from "@/lib/visited";
import type { DeliveryAvailability, FilterState, GeocodeResult, LatLng, Restaurant } from "@/lib/types";
import type { Deal } from "@/lib/deals";

export default function Home() {
  const [located, setLocated] = useState<GeocodeResult | null>(null);
  const [ipCenter, setIpCenter] = useState<LatLng | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [availability, setAvailability] = useState<Record<string, DeliveryAvailability>>({});
  const [doordashStatus, setDoordashStatus] = useState<Record<string, DeliveryAvailability["doordash"]>>({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [spinMode, setSpinMode] = useState<VisitedSpinMode>("all");
  const [mobileCollapsed, setMobileCollapsed] = useState(false);
  const [pinCenter, setPinCenter] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"nearby" | "deals">("nearby");
  const [deals, setDeals] = useState<Record<string, Deal[]>>({});
  const [dealsLoading, setDealsLoading] = useState(false);
  const { visited, toggle: toggleVisited } = useVisited();

  // Typing a new address takes priority over a dragged pin.
  useEffect(() => {
    if (located) setPinCenter(null);
  }, [located]);

  useEffect(() => {
    let cancelled = false;
    fetchIpLocation().then((loc) => {
      if (!cancelled && loc) setIpCenter(loc);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const availabilityMerged = useMemo(() => {
    const out: Record<string, DeliveryAvailability> = {};
    for (const id in availability) {
      out[id] = { ...availability[id], doordash: doordashStatus[id] ?? availability[id].doordash };
    }
    return out;
  }, [availability, doordashStatus]);

  const available = useMemo(() => {
    if (restaurants.length === 0) return [];
    const candidates = restaurants.filter((r) => r.delivery !== false);
    if (candidates.length === 0) return [];

    const allChecked = candidates.every((r) => availability[r.id] !== undefined);
    if (!allChecked) return candidates;

    const confirmed = candidates.filter((r) => {
      const a = availabilityMerged[r.id];
      return a && (a.grubhub || a.ubereats || a.doordash === "yes");
    });
    if (confirmed.length === 0) return candidates;
    return confirmed;
  }, [restaurants, availability, availabilityMerged]);
  const cuisines = useMemo(() => availableCuisines(available), [available]);
  const filtered = useMemo(() => applyFilters(available, filter), [available, filter]);

  useEffect(() => {
    const center = pinCenter ?? located?.location ?? ipCenter;
    if (!center) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    fetch("/api/places/nearby", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: center.lat, lng: center.lng }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `request failed: ${res.status}`);
        }
        return (await res.json()) as { restaurants: Restaurant[] };
      })
      .then((data) => {
        if (cancelled) return;
        setRestaurants(data.restaurants);
        setAvailability({});
        setDeals({});
        setDoordashStatus({});
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load restaurants");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pinCenter, located, ipCenter]);

  useEffect(() => {
    if (restaurants.length === 0) return;
    const candidates = restaurants.filter((r) => r.delivery !== false);
    if (candidates.length === 0) {
      setCheckingAvailability(false);
      return;
    }
    let cancelled = false;
    setCheckingAvailability(true);
    fetch("/api/delivery-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurants: candidates.map((r) => ({
          id: r.id,
          name: r.name,
          lat: r.location.lat,
          lng: r.location.lng,
        })),
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`availability ${res.status}`);
        return (await res.json()) as {
          availability: Record<string, DeliveryAvailability>;
        };
      })
      .then((data) => {
        if (!cancelled) setAvailability(data.availability ?? {});
      })
      .catch(() => {
        /* leave availability empty; nothing shows */
      })
      .finally(() => {
        if (!cancelled) setCheckingAvailability(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurants]);

  useEffect(() => {
    if (restaurants.length === 0) return;
    const candidates = restaurants.filter((r) => r.delivery !== false);
    if (candidates.length === 0) return;
    if (Object.keys(doordashStatus).length > 0) return; // already fetched for this set
    let cancelled = false;
    fetch("/api/doordash-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurants: candidates.map((r) => ({
          id: r.id,
          name: r.name,
          lat: r.location.lat,
          lng: r.location.lng,
        })),
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`doordash-check ${res.status}`);
        return (await res.json()) as { doordash: Record<string, DeliveryAvailability["doordash"]> };
      })
      .then((data) => {
        if (!cancelled) setDoordashStatus(data.doordash ?? {});
      })
      .catch(() => {
        /* leave doordash as "unknown"; buttons still show, list unchanged */
      });
    return () => {
      cancelled = true;
    };
  }, [restaurants, doordashStatus]);

  useEffect(() => {
    if (view !== "deals") return;
    if (available.length === 0) return;
    if (Object.keys(deals).length > 0) return; // already fetched for this restaurant set
    let cancelled = false;
    setDealsLoading(true);
    fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurants: available.map((r) => ({
          id: r.id,
          name: r.name,
          lat: r.location.lat,
          lng: r.location.lng,
        })),
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`deals ${res.status}`);
        return (await res.json()) as { deals: Record<string, Deal[]> };
      })
      .then((data) => {
        if (!cancelled) setDeals(data.deals ?? {});
      })
      .catch(() => {
        /* leave deals empty; panel shows empty state */
      })
      .finally(() => {
        if (!cancelled) setDealsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, available, deals]);

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  return (
    <div className="relative h-dvh w-screen overflow-hidden">
      <MapView
        center={located?.location ?? ipCenter}
        pinCenter={pinCenter ?? located?.location ?? ipCenter}
        precise={located !== null}
        restaurants={filtered}
        selectedId={selectedId}
        visited={visited}
        onSelect={handleSelect}
        onPinMove={setPinCenter}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-6">
        <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-black/60 p-4 shadow-xl backdrop-blur-xl">
          <h1 className="mb-3 text-xl font-semibold tracking-tight">FatChud.me</h1>
          <AddressInput onLocate={setLocated} />
          {pinCenter ? (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Pinned: {pinCenter.lat.toFixed(4)}, {pinCenter.lng.toFixed(4)}
            </p>
          ) : (
            located && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {located.formattedAddress}
              </p>
            )
          )}
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-6 right-6 top-32 z-10 hidden w-96 md:flex">
        <RestaurantPanel
          restaurants={available}
          filtered={filtered}
          filter={filter}
          cuisines={cuisines}
          selectedId={selectedId}
          availability={availabilityMerged}
          visited={visited}
          spinMode={spinMode}
          onSelect={handleSelect}
          onFilterChange={setFilter}
          onToggleVisited={toggleVisited}
          onSpinModeChange={setSpinMode}
          loading={loading || checkingAvailability}
          view={view}
          onViewChange={setView}
          deals={deals}
          dealsLoading={dealsLoading}
        />
      </div>

      <div
        className={`pointer-events-none absolute inset-x-4 bottom-4 z-10 md:hidden ${
          mobileCollapsed ? "h-auto" : "h-[55vh]"
        }`}
      >
        <RestaurantPanel
          restaurants={available}
          filtered={filtered}
          filter={filter}
          cuisines={cuisines}
          selectedId={selectedId}
          availability={availabilityMerged}
          visited={visited}
          spinMode={spinMode}
          onSelect={handleSelect}
          onFilterChange={setFilter}
          onToggleVisited={toggleVisited}
          onSpinModeChange={setSpinMode}
          loading={loading || checkingAvailability}
          view={view}
          onViewChange={setView}
          deals={deals}
          dealsLoading={dealsLoading}
          collapsible
          collapsed={mobileCollapsed}
          onToggleCollapsed={() => setMobileCollapsed((v) => !v)}
        />
      </div>
    </div>
  );
}
