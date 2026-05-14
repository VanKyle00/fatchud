"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AddressInput } from "@/components/AddressInput";
import { MapView } from "@/components/MapView";
import { RestaurantPanel } from "@/components/RestaurantPanel";
import { DEFAULT_FILTER, applyFilters, availableCuisines } from "@/lib/filters";
import { fetchIpLocation } from "@/lib/ip-location";
import { useVisited, type VisitedSpinMode } from "@/lib/visited";
import type { FilterState, GeocodeResult, LatLng, Restaurant } from "@/lib/types";

export default function Home() {
  const [located, setLocated] = useState<GeocodeResult | null>(null);
  const [ipCenter, setIpCenter] = useState<LatLng | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [availability, setAvailability] = useState<Record<string, { grubhub: boolean; ubereats: boolean; doordash: boolean }>>({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [spinMode, setSpinMode] = useState<VisitedSpinMode>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { visited, toggle: toggleVisited } = useVisited();

  useEffect(() => {
    let cancelled = false;
    fetchIpLocation().then((loc) => {
      if (!cancelled && loc) setIpCenter(loc);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const available = useMemo(
    () =>
      restaurants.filter((r) => {
        const a = availability[r.id];
        return a?.grubhub === true || a?.ubereats === true || a?.doordash === true;
      }),
    [restaurants, availability],
  );
  const cuisines = useMemo(() => availableCuisines(available), [available]);
  const filtered = useMemo(() => applyFilters(available, filter), [available, filter]);

  useEffect(() => {
    const center = located?.location ?? ipCenter;
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
  }, [located, ipCenter]);

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
          availability: Record<string, { grubhub: boolean; ubereats: boolean; doordash: boolean }>;
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

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <MapView
        center={located?.location ?? ipCenter}
        precise={located !== null}
        restaurants={filtered}
        selectedId={selectedId}
        visited={visited}
        onSelect={handleSelect}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-6">
        <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-black/60 p-4 shadow-xl backdrop-blur-xl">
          <h1 className="mb-3 text-xl font-semibold tracking-tight">FatChud.me</h1>
          <AddressInput onLocate={setLocated} />
          {located && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              {located.formattedAddress}
            </p>
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
          availability={availability}
          visited={visited}
          spinMode={spinMode}
          onSelect={handleSelect}
          onFilterChange={setFilter}
          onToggleVisited={toggleVisited}
          onSpinModeChange={setSpinMode}
          loading={loading || checkingAvailability}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 h-[55vh] md:hidden">
        <RestaurantPanel
          restaurants={available}
          filtered={filtered}
          filter={filter}
          cuisines={cuisines}
          selectedId={selectedId}
          availability={availability}
          visited={visited}
          spinMode={spinMode}
          onSelect={handleSelect}
          onFilterChange={setFilter}
          onToggleVisited={toggleVisited}
          onSpinModeChange={setSpinMode}
          loading={loading || checkingAvailability}
        />
      </div>
    </div>
  );
}
