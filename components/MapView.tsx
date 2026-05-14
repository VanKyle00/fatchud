"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng, Restaurant } from "@/lib/types";

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/positron";

type Props = {
  // Camera target — map flies/jumps when this changes (address typed, IP loaded).
  center: LatLng | null;
  // Pin marker target — moves when this changes, doesn't move the camera.
  // If null, no pin is shown.
  pinCenter: LatLng | null;
  precise: boolean;
  restaurants: Restaurant[];
  selectedId: string | null;
  visited: Set<string>;
  onSelect: (id: string) => void;
  // Fires when user drags the pin or clicks the map. Passes the new location.
  onPinMove?: (loc: LatLng) => void;
};

const APPROX_ZOOM = 12;
const PRECISE_ZOOM = 14;

function hidePoiLabels(map: maplibregl.Map) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type !== "symbol") continue;
    const id = layer.id.toLowerCase();
    if (id.includes("poi") || id.includes("transit")) {
      try {
        map.setLayoutProperty(layer.id, "visibility", "none");
      } catch {
        // best effort
      }
    }
  }
}

export function MapView({
  center,
  pinCenter,
  precise,
  restaurants,
  selectedId,
  visited,
  onSelect,
  onPinMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const searchPinRef = useRef<maplibregl.Marker | null>(null);
  const pinMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const hasJumpedRef = useRef(false);
  // Keep a live ref to onPinMove so the map click handler always calls the
  // latest callback without needing to re-bind on every parent re-render.
  const onPinMoveRef = useRef(onPinMove);
  onPinMoveRef.current = onPinMove;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const dark = mql.matches;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: dark ? STYLE_DARK : STYLE_LIGHT,
      center: [0, 20],
      zoom: 1.5,
      attributionControl: false,
    });
    // Reserve double-click for moving the search pin (see dblclick handler
    // below); otherwise MapLibre's default would zoom in on every double-click.
    map.doubleClickZoom.disable();
    mapRef.current = map;

    map.on("load", () => hidePoiLabels(map));

    const onThemeChange = (e: MediaQueryListEvent) => {
      map.setStyle(e.matches ? STYLE_DARK : STYLE_LIGHT);
      map.once("style.load", () => hidePoiLabels(map));
    };
    mql.addEventListener("change", onThemeChange);

    return () => {
      mql.removeEventListener("change", onThemeChange);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    const zoom = precise ? PRECISE_ZOOM : APPROX_ZOOM;
    if (!hasJumpedRef.current) {
      hasJumpedRef.current = true;
      map.jumpTo({ center: [center.lng, center.lat], zoom });
    } else {
      map.flyTo({
        center: [center.lng, center.lat],
        zoom,
        essential: true,
      });
    }
  }, [center, precise]);

  // Draggable search pin — moves independently of the camera. Updates when
  // pinCenter changes (from address typed, IP loaded, or its own dragend).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pinCenter) return;
    if (searchPinRef.current) {
      searchPinRef.current.setLngLat([pinCenter.lng, pinCenter.lat]);
      return;
    }
    const marker = new maplibregl.Marker({ color: "#e11d48", draggable: true })
      .setLngLat([pinCenter.lng, pinCenter.lat])
      .addTo(map);
    marker.on("dragend", () => {
      const { lng, lat } = marker.getLngLat();
      onPinMoveRef.current?.({ lat, lng });
    });
    searchPinRef.current = marker;
  }, [pinCenter]);

  // Double-click anywhere on the map (not on a marker) to move the search pin
  // there. Single-click is left alone so it can scroll/pan/select normally.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      onPinMoveRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on("dblclick", handler);
    return () => {
      map.off("dblclick", handler);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existing = pinMarkersRef.current;
    const nextIds = new Set(restaurants.map((r) => r.id));
    for (const [id, marker] of existing) {
      if (!nextIds.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }

    for (const r of restaurants) {
      if (existing.has(r.id)) continue;
      const wrapper = document.createElement("div");
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "wd-pin flex h-9 min-w-9 items-center justify-center gap-1 rounded-full border border-black/10 bg-white px-2 text-xs font-semibold tabular-nums shadow-md transition-transform duration-150 hover:scale-110 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50";
      button.textContent = r.rating ? r.rating.toFixed(1) : "·";
      if (visited.has(r.id)) button.classList.add("wd-pin-visited");
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(r.id);
      });
      wrapper.appendChild(button);
      const marker = new maplibregl.Marker({ element: wrapper })
        .setLngLat([r.location.lng, r.location.lat])
        .addTo(map);
      existing.set(r.id, marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurants, onSelect]);

  useEffect(() => {
    for (const [id, marker] of pinMarkersRef.current) {
      const button = marker.getElement().firstElementChild;
      if (!button) continue;
      if (id === selectedId) {
        button.classList.add("wd-pin-selected");
      } else {
        button.classList.remove("wd-pin-selected");
      }
    }
    const map = mapRef.current;
    if (map && selectedId) {
      const marker = pinMarkersRef.current.get(selectedId);
      if (marker) {
        const { lng, lat } = marker.getLngLat();
        map.flyTo({ center: [lng, lat], zoom: 15, essential: true });
      }
    }
  }, [selectedId]);

  useEffect(() => {
    for (const [id, marker] of pinMarkersRef.current) {
      const button = marker.getElement().firstElementChild;
      if (!button) continue;
      if (visited.has(id)) button.classList.add("wd-pin-visited");
      else button.classList.remove("wd-pin-visited");
    }
  }, [visited, restaurants]);

  return <div ref={containerRef} className="h-full w-full" />;
}
